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
		door_edges: {},
		door_sides: {},
		door_by_wall: new Map(),
	};
}

function _ensure_level_maps(door_data, level_id) {
	if (!door_data.door_edges[level_id]) door_data.door_edges[level_id] = new Map();
	if (!door_data.door_sides[level_id]) door_data.door_sides[level_id] = new Map();
}

function _register_door_edge(door_data, wall_id, level_id, x1, y1, x2, y2, passive) {
	_ensure_level_maps(door_data, level_id);
	const key = edge_key(x1, y1, x2, y2);
	if (passive) door_data.door_edges[level_id].set(key, wall_id);

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
 * @param {boolean} passive — also register door_edges for passive open-on-cross
 */
export function register_door(door_data, wall_id, level_id, gw, gh, wall_c, cell_size, passive) {
	for_each_wall_edge(gw, gh, wall_c, cell_size, (x1, y1, x2, y2) => {
		_register_door_edge(door_data, wall_id, level_id, x1, y1, x2, y2, passive);
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
