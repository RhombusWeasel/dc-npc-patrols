/**
 * doors.js — Door resolution, raster-time lookup tables, and state updates.
 */

import { edge_key, for_each_wall_edge } from "./utils.js";

const MODULE_ID = "dc-npc-patrols";

const DOOR_STATE_KEYS = {
	open: CONST.WALL_DOOR_STATES.OPEN,
	closed: CONST.WALL_DOOR_STATES.CLOSED,
	locked: CONST.WALL_DOOR_STATES.LOCKED,
};

export function door_state_from_key(key) {
	return DOOR_STATE_KEYS[key] ?? DOOR_STATE_KEYS.open;
}

export function get_door_sound_enabled() {
	return game.settings.get(MODULE_ID, "npc_door_sounds") ?? false;
}

/** Initialize empty door lookup structures for grid build. */
export function create_door_data() {
	return {
		door_edges: {},       // passive (auto-open) closed regular doors: edge_key → wall_id
		key_gated_edges: {},  // locked/secret doors: edge_key → wall_id (passable only with key)
		door_sides: {},       // approach cells: "x,y" → { wall_id, side }
		door_by_wall: new Map(), // wall_id → [{ x, y, level_id, side }]
	};
}

function _ensure_level_maps(door_data, level_id) {
	if (!door_data.door_edges[level_id]) door_data.door_edges[level_id] = new Map();
	if (!door_data.key_gated_edges[level_id]) door_data.key_gated_edges[level_id] = new Map();
	if (!door_data.door_sides[level_id]) door_data.door_sides[level_id] = new Map();
}

/**
 * Register a single door edge with its gating type.
 * @param {object} door_data
 * @param {string} wall_id
 * @param {string} level_id
 * @param {number} x1, y1, x2, y2 — nav-cell edge endpoints
 * @param {'passive'|'key_gated'|'open'} gating — passive = auto-open, key_gated = requires key, open = approach cells only (passable, still pathable-to for closing)
 */
function _register_door_edge(door_data, wall_id, level_id, x1, y1, x2, y2, gating) {
	_ensure_level_maps(door_data, level_id);
	const key = edge_key(x1, y1, x2, y2);
	if (gating === 'passive') {
		door_data.door_edges[level_id].set(key, wall_id);
	} else if (gating === 'key_gated') {
		door_data.key_gated_edges[level_id].set(key, wall_id);
	}
	// 'open' gating registers approach cells only — the edge stays passable
	// (no door_edges / key_gated_edges entry) so tokens can walk through,
	// but action_door_interact can still path to the door to close/lock it.

	const parts = key.split(">");
	const [ax, ay] = parts[0].split(",").map(Number);
	const [bx, by] = parts[1].split(",").map(Number);

	door_data.door_sides[level_id].set(`${ax},${ay}`, { wall_id, side: 0 });
	door_data.door_sides[level_id].set(`${bx},${by}`, { wall_id, side: 1 });

	if (!door_data.door_by_wall.has(wall_id)) door_data.door_by_wall.set(wall_id, []);
	const entries = door_data.door_by_wall.get(wall_id);
	entries.push({ x: ax, y: ay, level_id, side: 0 });
	entries.push({ x: bx, y: by, level_id, side: 1 });
}

/**
 * Register door edges and per-side approach cells during grid rasterization.
 * @param {'passive'|'key_gated'|'open'} gating — passive = auto-open, key_gated = requires key, open = approach cells only (passable, still pathable-to for closing)
 */
export function register_door(door_data, wall_id, level_id, gw, gh, wall_c, cell_size, gating) {
	for_each_wall_edge(gw, gh, wall_c, cell_size, (x1, y1, x2, y2) => {
		_register_door_edge(door_data, wall_id, level_id, x1, y1, x2, y2, gating);
	});
}

export async function resolve_wall(scene, wall_ref) {
	if (!wall_ref || !scene) return null;
	const ref = String(wall_ref).trim();
	let wall = scene.walls.get(ref);
	if (!wall && ref.includes(".")) {
		wall = await fromUuid(ref);
		if (wall?.parent?.id !== scene.id) wall = null;
	}
	if (!wall || wall.door <= CONST.WALL_DOOR_TYPES.NONE) return null;
	return wall;
}

/**
 * Collect nav-cell edge keys crossed when moving between grid tiles.
 */
function _tile_step_edge_keys(from_gx, from_gy, to_gx, to_gy, nav_res) {
	const keys = [];
	const dgx = to_gx - from_gx;
	const dgy = to_gy - from_gy;
	const x0 = from_gx * nav_res;
	const y0 = from_gy * nav_res;

	if (dgx && !dgy) {
		const ex = dgx > 0 ? x0 + nav_res - 1 : x0;
		const nx = dgx > 0 ? x0 + nav_res : x0 - 1;
		for (let cy = y0; cy < y0 + nav_res; cy++) {
			keys.push(edge_key(ex, cy, nx, cy));
		}
	} else if (dgy && !dgx) {
		const ey = dgy > 0 ? y0 + nav_res - 1 : y0;
		const ny = dgy > 0 ? y0 + nav_res : y0 - 1;
		for (let cx = x0; cx < x0 + nav_res; cx++) {
			keys.push(edge_key(cx, ey, cx, ny));
		}
	} else if (dgx && dgy) {
		const corner_nx = x0 + (dgx > 0 ? nav_res - 1 : 0);
		const corner_ny = y0 + (dgy > 0 ? nav_res - 1 : 0);
		keys.push(edge_key(corner_nx, corner_ny, corner_nx + dgx, corner_ny));
		keys.push(edge_key(corner_nx + dgx, corner_ny, corner_nx + dgx, corner_ny + dgy));
		keys.push(edge_key(corner_nx, corner_ny, corner_nx, corner_ny + dgy));
		keys.push(edge_key(corner_nx, corner_ny + dgy, corner_nx + dgx, corner_ny + dgy));
	}
	return keys;
}

/**
 * Find closed regular doors crossed on a grid-tile movement step (cached lookup).
 */
export function find_doors_on_tile_step(from_gx, from_gy, to_gx, to_gy, grid_data, level_id, scene) {
	if (!grid_data || !scene) return [];
	const nav_res = grid_data.nav_resolution ?? 1;
	const level = level_id ?? "_default";
	const door_edges = grid_data.door_edges?.[level];
	if (!door_edges?.size) return [];

	const wall_ids = new Set();
	for (const key of _tile_step_edge_keys(from_gx, from_gy, to_gx, to_gy, nav_res)) {
		const id = door_edges.get(key);
		if (id) wall_ids.add(id);
	}

	const doors = [];
	for (const id of wall_ids) {
		const wall = scene.walls.get(id);
		if (wall) doors.push(wall);
	}
	return doors;
}

export async function set_door_state(wall, state, opts = {}) {
	if (!wall || wall.ds === state) return wall;
	const sound = opts.sound ?? get_door_sound_enabled();
	return wall.update({ ds: state }, { sound });
}

export async function open_door(wall, opts = {}) {
	if (wall?.ds !== CONST.WALL_DOOR_STATES.CLOSED) return wall;
	return set_door_state(wall, CONST.WALL_DOOR_STATES.OPEN, opts);
}

export async function close_door(wall, opts = {}) {
	if (wall?.ds !== CONST.WALL_DOOR_STATES.OPEN) return wall;
	return set_door_state(wall, CONST.WALL_DOOR_STATES.CLOSED, opts);
}

/**
 * Cached approach nav cells for a door wall.
 * @returns {Array<{x: number, y: number, level_id: string, side: number}>}
 */
export function get_door_approach_cells(wall, grid_data) {
	if (!wall || !grid_data?.door_by_wall) return [];
	return grid_data.door_by_wall.get(wall.id) ?? [];
}

/**
 * Whether the token occupies a nav cell on either side of the door.
 */
export function is_token_adjacent_to_door(token_doc, wall, scene, level_id, grid_data) {
	if (!token_doc || !wall || !grid_data) return false;
	const cell_size = grid_data.cell_size;
	const token_nx = Math.floor(token_doc.x / cell_size);
	const token_ny = Math.floor(token_doc.y / cell_size);
	const token_level = level_id ?? token_doc.level ?? "_default";
	const sides = grid_data.door_sides?.[token_level];
	if (!sides) return false;

	const entry = sides.get(`${token_nx},${token_ny}`);
	return entry?.wall_id === wall.id;
}

// ─── Key-gated door helpers ───────────────────────────────────────────────

/**
 * Extract the set of wall UUIDs that an actor holds keys for.
 * Scans char.gear.keys for items with a non-empty wall_uuid.
 * @param {Actor} actor
 * @returns {Set<string>} set of wall UUID strings
 */
export function get_actor_key_uuids(actor) {
	const uuids = new Set();
	if (!actor) return uuids;
	const keys = actor.system?.char?.gear?.keys;
	if (!keys) return uuids;
	for (const key of Object.values(keys)) {
		if (key?.wall_uuid) uuids.add(key.wall_uuid);
	}
	return uuids;
}

/**
 * Check if a nav-cell edge is key-gated and whether the pathing NPC has the key.
 * @param {Set} blocked_edges — level blocked edge set (not used, but kept for API consistency)
 * @param {number} x1, y1, x2, y2 — edge endpoints
 * @param {Map} key_gated_edges — level's key_gated_edges map (edge_key → wall_id)
 * @param {string} scene_id — scene id for UUID construction
 * @param {Set<string>|null} key_uuids — set of wall UUIDs the NPC has keys for
 * @returns {boolean} true if edge is passable (has key or not key-gated)
 */
export function is_key_gated_edge_passable(x1, y1, x2, y2, key_gated_edges, scene_id, key_uuids) {
	if (!key_gated_edges?.size) return true; // no key-gated doors on this level
	const key = edge_key(x1, y1, x2, y2);
	const wall_id = key_gated_edges.get(key);
	if (!wall_id) return true; // not a key-gated edge

	// The wall UUID is Scene.<scene_id>.Wall.<wall_id>
	const wall_uuid = `Scene.${scene_id}.Wall.${wall_id}`;
	if (key_uuids?.has(wall_uuid)) return true; // NPC has the key

	return false; // key-gated and NPC doesn't have the key
}

/**
 * Find key-gated (locked/secret) doors crossed on a grid-tile movement step.
 * Returns wall documents that the NPC has keys for.
 * @param {number} from_gx, from_gy, to_gx, to_gy — grid-tile coords
 * @param {object} grid_data
 * @param {string} level_id
 * @param {Scene} scene
 * @param {Set<string>|null} key_uuids — wall UUIDs the NPC has keys for (null = none)
 * @returns {Array<WallDocument>}
 */
export function find_keyed_doors_on_tile_step(from_gx, from_gy, to_gx, to_gy, grid_data, level_id, scene, key_uuids) {
	if (!grid_data || !scene) return [];
	const nav_res = grid_data.nav_resolution ?? 1;
	const level = level_id ?? "_default";
	const key_gated = grid_data.key_gated_edges?.[level];
	if (!key_gated?.size) return [];

	const wall_ids = new Set();
	for (const ekey of _tile_step_edge_keys(from_gx, from_gy, to_gx, to_gy, nav_res)) {
		const wid = key_gated.get(ekey);
		if (wid) wall_ids.add(wid);
	}
	if (!wall_ids.size) return [];

	const scene_id = scene.id;
	const doors = [];
	for (const wid of wall_ids) {
		const wall_uuid = `Scene.${scene_id}.Wall.${wid}`;
		if (!key_uuids?.has(wall_uuid)) continue; // NPC doesn't have the key
		const wall = scene.walls.get(wid);
		if (wall) doors.push(wall);
	}
	return doors;
}
