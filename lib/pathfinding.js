/**
 * pathfinding.js — Multi-level A* pathfinding engine for wall-aware NPC navigation.
 *
 * Builds a walkability grid from scene walls, auto-detects Foundry's native
 * changeLevel region behaviors for stair transitions between floors — zero
 * extra configuration needed.
 *
 * The grid and paths are cached in-memory and invalidated when walls or
 * regions change (via hooks in main.js).
 */

import { _rasterize_wall, _get_region_cells, _is_edge_blocked, block_edge } from "./utils.js";
import { get_door_approach_cells, create_door_data, register_door } from "./doors.js";
import { find_nearest_region } from "./region_utils.js";
import { bt_perf_path_cache_hit, bt_perf_path_cache_miss, bt_perf_path_budget_hit } from "./bt_debug.js";

const MODULE_ID = "dc-npc-patrols";

/**
 * Sentinel returned by path queries when the A* search exceeded its time
 * budget mid-run but has NOT yet found a path (or proven none exists).
 * The search state is persisted in _path_sessions and resumed on the next
 * query with the same cache key. Callers should treat this as "keep trying
 * on a later tick", not as "no path".
 */
export const PENDING_PATH = Symbol("pending-path");

const DIRECTIONS_8 = [
	[-1,-1],[0,-1],[1,-1],
	[-1, 0],       [1, 0],
	[-1, 1],[0, 1],[1, 1],
];

export class Pathfinding {
	constructor() {
		this._grid_cache = new Map();   // scene_id → { grids, stairs_cells, ... }
		this._path_cache = new Map();   // scene_id → Map(src_key,dest_key → path)
		this._tick_path_cache = new Map(); // scene_id → Map (tick-scoped when block_tokens)
		this._on_path_callback = null; // optional callback(path) for debug overlay
		this._tick_id = 0;
		this._tick_scene_id = null;
		this._token_cells_cache = null;
		// Resumable A* search sessions — scene_id → Map(cache_key → session).
		// A* spreads one search across successive ticks, persisting its open
		// heap / g-scores / closed set here so a long path (multi-goal region
		// search, cross-map relocation) can complete without a 150ms+ block.
		this._path_sessions = new Map();
		this.PENDING_PATH = PENDING_PATH;
	}

	/** Start a BT tick — enables per-tick occupancy and path caches. */
	begin_tick(tick_id, scene) {
		this._tick_id = tick_id;
		this._tick_scene_id = scene?.id ?? null;
		this._token_cells_cache = null;
		if (this._uses_tick_scoped_paths() && this._tick_scene_id) {
			this._tick_path_cache.set(this._tick_scene_id, new Map());
		}
	}

	end_tick() {
		this._token_cells_cache = null;
	}

	/** Clear per-tick occupancy/path caches after an NPC moves or finishes ticking. */
	invalidate_tick_caches() {
		this._token_cells_cache = null;
		if (this._uses_tick_scoped_paths() && this._tick_scene_id) {
			this._tick_path_cache.set(this._tick_scene_id, new Map());
		}
	}

	_uses_tick_scoped_paths() {
		try {
			return game.settings.get(MODULE_ID, "block_tokens");
		} catch {
			return true;
		}
	}

	_get_path_cache_map(scene_id) {
		if (this._uses_tick_scoped_paths() && this._tick_scene_id === scene_id) {
			if (!this._tick_path_cache.has(scene_id)) {
				this._tick_path_cache.set(scene_id, new Map());
			}
			return this._tick_path_cache.get(scene_id);
		}
		if (!this._path_cache.has(scene_id)) {
			this._path_cache.set(scene_id, new Map());
		}
		return this._path_cache.get(scene_id);
	}

	_lookup_path_cache(scene_id, cache_key) {
		const map = this._get_path_cache_map(scene_id);
		if (map.has(cache_key)) {
			bt_perf_path_cache_hit();
			return map.get(cache_key);
		}
		bt_perf_path_cache_miss();
		return undefined;
	}

	_store_path_cache(scene_id, cache_key, path) {
		this._get_path_cache_map(scene_id).set(cache_key, path);
	}

	/** Set a callback invoked after each successful path computation (for debug overlay) */
	set_on_path_callback(fn) { this._on_path_callback = fn; }

	// Main API: find a path from source to destination
	// options.exclude_token_id — token id to exclude from blocking (the pathing NPC itself)
	// options.key_uuids — Set of wall UUIDs the NPC has keys for (for key-gated doors)
	find_path(scene, source, dest, options = {}) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const cell_size = grid_data.cell_size;
		const src_x = Math.floor(source.x / cell_size);
		const src_y = Math.floor(source.y / cell_size);
		const src_level = source.level_id ?? this._default_level(scene);
		const dst_x = Math.floor(dest.x / cell_size);
		const dst_y = Math.floor(dest.y / cell_size);
		const dst_level = dest.level_id ?? src_level;

		// Compute token occupancy (excludes the pathing token itself)
		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, grid_data.gw, grid_data.gh, options.exclude_token_id,
		);

		// Check cache — include exclude_token_id + key_uuids in key since blocked cells differ per NPC
		const excl = options.exclude_token_id ?? 'none';
		const has_keys = options.key_uuids?.size ? 'keys' : 'nokeys';
		const cache_key = `${src_x},${src_y},${src_level}>${dst_x},${dst_y},${dst_level}|${excl}|${has_keys}`;

		// Run (or resume) the A* search; PENDING_PATH means the budget ran out
		// this tick and the search continues on a later query with this key.
		return this._search_with_session(scene.id, cache_key, grid_data, src_x, src_y, src_level, {
			dx: dst_x, dy: dst_y, dst_level,
			blocked_by_level, key_uuids: options.key_uuids,
		});
	}

	/**
	 * Pick a random grid cell inside a region that is reachable from source.
	 * @returns {{ x: number, y: number, level_id?: string }|null} grid coords
	 */
	pick_random_reachable_cell(scene, source, region_name, max_attempts = 8, options = {}) {
		const region = find_nearest_region(scene, region_name, source);
		if (!region) return null;
		return this.pick_random_reachable_cell_in_region(scene, source, region, max_attempts, options);
	}

	pick_random_reachable_cell_in_region(scene, source, region, max_attempts = 8, options = {}) {
		if (!region) return null;

		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw;
		const gh = grid_data.gh;
		const region_cells = _get_region_cells(region, gw, gh, cell_size);
		if (!region_cells.length) return null;

		const all_levels = Object.keys(grid_data.grids);
		const region_levels = region.levels?.size
			? [...region.levels]
			: all_levels;

		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, gw, gh, options.exclude_token_id,
		);

		const candidates = [];
		for (const cell of region_cells) {
			for (const lvl of region_levels) {
				const blocked = blocked_by_level.get(lvl);
				if (blocked?.has(`${cell.x},${cell.y}`)) continue;
				candidates.push({ x: cell.x, y: cell.y, level_id: lvl });
			}
		}

		// If all goal cells were filtered out, fall back to unfiltered
		if (!candidates.length) {
			for (const cell of region_cells) {
				for (const lvl of region_levels) {
					candidates.push({ x: cell.x, y: cell.y, level_id: lvl });
				}
			}
		}

		if (!candidates.length) return null;

		for (let i = candidates.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[candidates[i], candidates[j]] = [candidates[j], candidates[i]];
		}

		const attempts = Math.min(max_attempts, candidates.length);

		for (let i = 0; i < attempts; i++) {
			const goal = candidates[i];
			const path = this.find_path(
				scene,
				source,
				{
					x: goal.x * cell_size,
					y: goal.y * cell_size,
					level_id: goal.level_id,
				},
				options,
			);
			if (path === PENDING_PATH) return PENDING_PATH;
			if (path?.length) {
				return { x: goal.x, y: goal.y, level_id: goal.level_id };
			}
		}

		return null;
	}

	// Multi-goal A*
	// Used by action_move_to_region. Expands outward from source, stops when any
	// cell inside the target region is dequeued — gives the shortest wall-aware path.
	find_path_to_region(scene, source, region_name, options = {}) {
		const region = find_nearest_region(scene, region_name, source);
		if (!region) return null;
		return this.find_path_to_region_doc(scene, source, region, options);
	}

	find_path_to_region_doc(scene, source, region, options = {}) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data || !region) return null;

		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw;
		const gh = grid_data.gh;

		const region_cells = _get_region_cells(region, gw, gh, cell_size);
		if (!region_cells.length) return null;

		const all_levels = Object.keys(grid_data.grids);
		const region_levels = region.levels?.size
			? [...region.levels]
			: all_levels;

		// Compute token occupancy to filter occupied goal cells
		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, gw, gh, options.exclude_token_id,
		);

		const goal_cells = new Set();
		for (const cell of region_cells) {
			for (const lvl of region_levels) {
				// Skip cells occupied by another token on this level
				const blocked = blocked_by_level.get(lvl);
				if (blocked?.has(`${cell.x},${cell.y}`)) continue;
				goal_cells.add(`${cell.x},${cell.y},${lvl}`);
			}
		}

		// If all goal cells were filtered out, fall back to unfiltered
		if (!goal_cells.size) {
			for (const cell of region_cells) {
				for (const lvl of region_levels) {
					goal_cells.add(`${cell.x},${cell.y},${lvl}`);
				}
			}
		}

		const src_x = Math.floor(source.x / cell_size);
		const src_y = Math.floor(source.y / cell_size);
		const src_level = source.level_id ?? this._default_level(scene);

		const excl = options.exclude_token_id ?? 'none';
		const has_keys = options.key_uuids?.size ? 'keys' : 'nokeys';
		const cache_key = `${src_x},${src_y},${src_level}>region:${region.id}|${excl}|${has_keys}`;

		return this._search_with_session(scene.id, cache_key, grid_data, src_x, src_y, src_level, {
			goal_cells,
			blocked_by_level, key_uuids: options.key_uuids,
		});
	}

	// Multi-goal A* to the nearest walkable cell adjacent to a door wall.
	find_path_to_wall(scene, source, wall, options = {}) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data || !wall) return null;

		const approach_cells = get_door_approach_cells(wall, grid_data);
		if (!approach_cells.length) return null;

		const cell_size = grid_data.cell_size;

		// Compute token occupancy to filter occupied approach cells
		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, grid_data.gw, grid_data.gh, options.exclude_token_id,
		);

		const goal_cells = new Set();
		for (const cell of approach_cells) {
			const blocked = blocked_by_level.get(cell.level_id);
			if (blocked?.has(`${cell.x},${cell.y}`)) continue;
			goal_cells.add(`${cell.x},${cell.y},${cell.level_id}`);
		}
		// If all filtered, fall back to unfiltered
		if (!goal_cells.size) {
			for (const cell of approach_cells) {
				goal_cells.add(`${cell.x},${cell.y},${cell.level_id}`);
			}
		}

		const src_x = Math.floor(source.x / cell_size);
		const src_y = Math.floor(source.y / cell_size);
		const src_level = source.level_id ?? this._default_level(scene);

		const excl = options.exclude_token_id ?? 'none';
		const has_keys = options.key_uuids?.size ? 'keys' : 'nokeys';
		const cache_key = `${src_x},${src_y},${src_level}>wall:${wall.id}|${excl}|${has_keys}`;

		return this._search_with_session(scene.id, cache_key, grid_data, src_x, src_y, src_level, {
			goal_cells,
			blocked_by_level, key_uuids: options.key_uuids,
		});
	}

	// Invalidate caches for a scene (called on wall/region changes)
	invalidate(scene_id) {
		this._grid_cache.delete(scene_id);
		this._path_cache.delete(scene_id);
		this._path_sessions.delete(scene_id);
	}

	// Invalidate only path caches (called on token movement when block_tokens is on).
	// The wall grid is unaffected by token moves — token occupancy is computed
	// at query time, not cached in the grid.
	invalidate_paths(scene_id) {
		this._path_cache.delete(scene_id);
		this._path_sessions.delete(scene_id);
	}

	get_grid_data(scene) {
		return this._get_or_build_grid(scene);
	}

	// ── Grid Building ─────────────────────────────────────────────

	_process_walls_for_level(walls, level_id, gw, gh, cell_size, blocked_edges, door_data) {
		for (const wall of walls) {
			if (wall.move === CONST.WALL_MOVEMENT_TYPES.NONE) continue;
			if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.OPEN) continue;

			const is_closed_regular =
				wall.door === CONST.WALL_DOOR_TYPES.DOOR &&
				wall.ds === CONST.WALL_DOOR_STATES.CLOSED;
			const is_open = wall.ds === CONST.WALL_DOOR_STATES.OPEN;

			if (wall.door > 0) {
				if (is_open) continue;
				const gating = is_closed_regular ? 'passive' : 'key_gated';
				register_door(door_data, wall.id, level_id, gw, gh, wall.c, cell_size, gating);
				// Closed regular doors & locked/secret doors are passable edges (auto-open or key-gated).
				// Only rasterize non-door walls as solid.
			} else {
				_rasterize_wall(blocked_edges, gw, gh, wall.c, cell_size);
			}
		}
	}

	_get_or_build_grid(scene) {
		if (this._grid_cache.has(scene.id)) return this._grid_cache.get(scene.id);

		const nav_res = game.settings.get("dc-npc-patrols", "nav_resolution") || 1;
		const cell_size = scene.grid.size / nav_res;
		const levels = scene.levels.contents.sort((a, b) => a.elevation.base - b.elevation.base);
		// Use scene.dimensions which includes padding, not raw scene.width/height
		// Tokens and regions can be positioned in the padded area beyond scene.width
		const scene_w = scene.dimensions?.width ?? scene.width;
		const scene_h = scene.dimensions?.height ?? scene.height;
		const gw = Math.ceil(scene_w / cell_size);
		const gh = Math.ceil(scene_h / cell_size);

		// No levels = single flat grid
		if (!levels.length) {
			const blocked_edges = new Set();
			const door_data = create_door_data();
			this._process_walls_for_level(
				scene.walls, "_default", gw, gh, cell_size, blocked_edges, door_data
			);
			const terrain_costs = this._rasterize_terrain_costs(scene, gw, gh, cell_size, [{ id: '_default' }]);
			const result = {
				grids: { _default: blocked_edges },
				levels: [{ id: '_default', elevation: { base: scene.elevation ?? 0 } }],
				stairs_cells: new Map(),
				terrain_costs,
				gw, gh, cell_size, nav_resolution: nav_res,
				door_edges: door_data.door_edges,
				key_gated_edges: door_data.key_gated_edges,
				door_sides: door_data.door_sides,
				door_by_wall: door_data.door_by_wall,
			};
			this._grid_cache.set(scene.id, result);
			return result;
		}

		// Multi-level: one grid per level
		const grids = {};
		const door_data = create_door_data();
		for (const level of levels) {
			const blocked_edges = new Set();
			const level_walls = scene.walls.filter(w => _wall_affects_level(w, level));
			this._process_walls_for_level(
				level_walls, level.id, gw, gh, cell_size, blocked_edges, door_data
			);
			grids[level.id] = blocked_edges;
		}

		// Stairs: auto-detect changeLevel region behaviors
		const stairs_cells = new Map();
		for (const region of scene.regions) {
			const has_change_level = region.behaviors.some(b => b.type === "changeLevel");
			if (!has_change_level) continue;

			// Region.levels tells us which levels this connects
			// Empty levels set = connects ALL levels; otherwise connects the listed ones
			const connected = region.levels.size
				? [...region.levels]
				: levels.map(l => l.id);

			const cells = _get_region_cells(region, gw, gh, cell_size);

			for (const { x, y } of cells) {
				for (const levelId of connected) {
					const key = `${x},${y},${levelId}`;
					if (!stairs_cells.has(key)) stairs_cells.set(key, []);
					for (const other of connected) {
						if (other !== levelId && !stairs_cells.get(key).includes(other)) {
							stairs_cells.get(key).push(other);
						}
					}
				}
			}
		}

		const terrain_costs = this._rasterize_terrain_costs(scene, gw, gh, cell_size, levels);
		const result = {
			grids, levels, stairs_cells, terrain_costs, gw, gh, cell_size, nav_resolution: nav_res,
			door_edges: door_data.door_edges,
			key_gated_edges: door_data.key_gated_edges,
			door_sides: door_data.door_sides,
			door_by_wall: door_data.door_by_wall,
		};
		this._grid_cache.set(scene.id, result);
		return result;
	}

	// ── A* Algorithm ───────────────────────────────────────────────

	/** Deadline (performance.now) by which a single A* run must stop, or null for unlimited. */
	_path_budget_deadline() {
		try {
			const ms = game.settings.get(MODULE_ID, "bt_path_budget_ms") || 0;
			return ms > 0 ? performance.now() + ms : null;
		} catch {
			return null;
		}
	}

	/**
	 * Advance a resumable A* search by up to one budget slice.
	 *
	 * The session holds the in-progress open heap / g-scores / came-from so a
	 * long search (multi-goal region relocation, cross-map wander) can span
	 * several BT ticks without a single 150ms+ blocking call. The deadlined
	 * slice returns `{ status: "pending" }` when the budget is exhausted before
	 * a result; the caller keeps the session for the next query with the same
	 * cache key.
	 *
	 * @returns {{ status: "found", path: object[] } |
	 *           { status: "done", path: null } |
	 *           { status: "pending" }}
	 */
	_run_search_slice(scene_id, cache_key, session, grid_data, blocked_by_level, key_uuids) {
		const deadline = this._path_budget_deadline();
		const { open, came_from, g_score, closed } = session;
		const is_multi = session.goal_cells != null;

		while (open.size > 0) {
			if (deadline != null && performance.now() > deadline) {
				bt_perf_path_budget_hit();
				return { status: "pending" };
			}
			const current = open.pop();
			const cur_key = `${current.x},${current.y},${current.level}`;

			if (closed.has(cur_key)) continue;
			closed.add(cur_key);

			// Goal check: single-goal uses a single key; multi-goal tests the set.
			const is_goal = is_multi
				? session.goal_cells.has(cur_key)
				: cur_key === session.goal_key;
			if (is_goal) {
				return { status: "found", path: _reconstruct_path(came_from, cur_key, grid_data) };
			}

			const neighbors = this._get_neighbors(
				current.x, current.y, current.level, grid_data, blocked_by_level, scene_id, key_uuids,
			);
			for (const nb of neighbors) {
				const nb_key = `${nb.x},${nb.y},${nb.level}`;
				const tentative_g = (g_score.get(cur_key) ?? Infinity) + nb.cost;
				if (tentative_g < (g_score.get(nb_key) ?? Infinity)) {
					came_from.set(nb_key, cur_key);
					g_score.set(nb_key, tentative_g);
					const h = is_multi
						? _multi_goal_heuristic(nb, session.goal_list)
						: _heuristic(nb.x, nb.y, session.dst_x, session.dst_y, nb.level, session.dst_level);
					open.push({ x: nb.x, y: nb.y, level: nb.level, f: tentative_g + h });
				}
			}
		}
		// Open set exhausted — the search is complete with no path.
		return { status: "done", path: null };
	}

	/**
	 * Create a fresh search session (no slice run — the caller runs it).
	 * @returns {object} session
	 */
	_begin_search(grid_data, sx, sy, src_level, opts) {
		const open = new MinHeap();
		const came_from = new Map();
		const g_score = new Map();
		const closed = new Set();

		const start_key = `${sx},${sy},${src_level}`;
		g_score.set(start_key, 0);

		const session = { open, came_from, g_score, closed, start_key };
		if (opts.goal_cells != null) {
			session.goal_cells = opts.goal_cells;
			// Parse the goal keys ("x,y,level") into coordinates so the search
			// can use an admissible distance heuristic instead of expanding
			// uniformly in all directions (Dijkstra). For a distant goal this
			// is the difference between sweeping the whole map and aiming at it.
			session.goal_list = [];
			for (const key of opts.goal_cells) {
				const parts = key.split(',');
				if (parts.length >= 2) {
					session.goal_list.push({
						x: parseInt(parts[0], 10),
						y: parseInt(parts[1], 10),
						level: parts[2],
					});
				}
			}
			open.push({ x: sx, y: sy, level: src_level, f: 0 });
		} else {
			session.goal_key = `${opts.dx},${opts.dy},${opts.dst_level}`;
			session.dst_x = opts.dx;
			session.dst_y = opts.dy;
			session.dst_level = opts.dst_level;
			open.push({
				x: sx, y: sy, level: src_level,
				f: _heuristic(sx, sy, opts.dx, opts.dy, src_level, opts.dst_level),
			});
		}
		return session;
	}

	/**
	 * Run (or resume) a search for a cache key, then store/clear its session.
	 *
	 * - If a session already exists for the key, continue it (resume across ticks).
	 * - On "found"/"done", drop the session and store the finished path in the
	 *   path cache so subsequent queries short-circuit.
	 * - On "pending", keep the session for the next query with the same key and
	 *   return PENDING_PATH (transient "not finished yet", never cached as no-path).
	 *
	 * @param {string} scene_id
	 * @param {string} cache_key
	 * @param {object} grid_data
	 * @param {number} sx
	 * @param {number} sy
	 * @param {string} src_level
	 * @param {object} opts — { dx, dy, dst_level } for single-goal, or { goal_cells }
	 *   for multi-goal, plus { blocked_by_level, key_uuids, cache_path }.
	 * @returns {object[]|Symbol} finished path, null (no path), or PENDING_PATH
	 */
	_search_with_session(scene_id, cache_key, grid_data, sx, sy, src_level, opts) {
		const cache_path = opts.cache_path !== false;

		// Fast path: a completed result is already cached.
		if (cache_path) {
			const cached = this._lookup_path_cache(scene_id, cache_key);
			if (cached !== undefined) return cached;
		}

		let session = this._path_sessions.get(scene_id)?.get(cache_key) ?? null;
		if (!session) {
			session = this._begin_search(grid_data, sx, sy, src_level, opts);
			// Pin the occupancy snapshot this search started with so resumed
			// slices keep consistent cost/blocking across ticks while the token
			// is still (hasn't started moving yet).
			session.blocked_by_level = opts.blocked_by_level ?? null;
			session.key_uuids = opts.key_uuids ?? null;
		}

		const result = this._run_search_slice(
			scene_id, cache_key, session, grid_data, session.blocked_by_level, session.key_uuids,
		);

		if (result.status === "pending") {
			// Keep the session for the next tick.
			if (!this._path_sessions.has(scene_id)) this._path_sessions.set(scene_id, new Map());
			this._path_sessions.get(scene_id).set(cache_key, session);
			return PENDING_PATH;
		}

		// Search finished — drop the session.
		const scene_sessions = this._path_sessions.get(scene_id);
		if (scene_sessions) {
			scene_sessions.delete(cache_key);
			if (!scene_sessions.size) this._path_sessions.delete(scene_id);
		}

		if (cache_path) this._store_path_cache(scene_id, cache_key, result.path);
		if (this._on_path_callback) this._on_path_callback(result.path);
		return result.path;
	}

	/**
	 * Scan scene regions for dcTerrainCost behaviors and rasterize their cells
	 * into a per-level cost map. When multiple cost regions overlap, the highest
	 * cost wins (most restrictive terrain dominates).
	 *
	 * @param {Scene} scene
	 * @param {number} gw — grid width in nav cells
	 * @param {number} gh — grid height in nav cells
	 * @param {number} cell_size — nav cell size in pixels
	 * @param {Array<{id: string}>} levels — level objects with id field
	 * @returns {Map<string, Map<string, number>>} level_id → Map<'x,y', cost>
	 */
	_rasterize_terrain_costs(scene, gw, gh, cell_size, levels) {
		const terrain_costs = new Map();
		for (const lvl of levels) terrain_costs.set(lvl.id, new Map());

		const cost_type = `${MODULE_ID}.dcTerrainCost`;
		for (const region of scene.regions) {
			for (const behavior of region.behaviors) {
				if (behavior.type !== cost_type) continue;
				const cost = behavior.system?.cost;
				if (!cost || cost <= 1) continue;

				const cells = _get_region_cells(region, gw, gh, cell_size);
				const region_levels = region.levels?.size
					? [...region.levels]
					: levels.map(l => l.id);

				for (const { x, y } of cells) {
					const key = `${x},${y}`;
					for (const lvl_id of region_levels) {
						const level_map = terrain_costs.get(lvl_id);
						if (!level_map) continue;
						const existing = level_map.get(key) ?? 1;
						if (cost > existing) level_map.set(key, cost);
					}
				}
			}
		}
		return terrain_costs;
	}

	_get_neighbors(x, y, level_id, grid_data, blocked_by_level = null, scene_id = null, key_uuids = null) {
		const { grids, stairs_cells, gw, gh } = grid_data;
		const neighbors = [];
		const blocked_edges = grids[level_id] ?? grids['_default'];
		const blocked_cells = blocked_by_level?.get(level_id) ?? null;
		const key_gated = grid_data.key_gated_edges?.[level_id];
		const terrain_cost_map = grid_data.terrain_costs?.get(level_id);

		// Helper: check if edge is key-gated and NPC lacks the key
		const is_key_blocked = (x1, y1, x2, y2) => {
			if (!key_gated?.size) return false;
			const ekey = `${x1},${y1}>${x2},${y2}`;
			const wall_id = key_gated.get(ekey) ?? key_gated.get(`${x2},${y2}>${x1},${y1}`);
			if (!wall_id) return false;
			const wall_uuid = `Scene.${scene_id}.Wall.${wall_id}`;
			return !key_uuids?.has(wall_uuid);
		};

		// 8-directional on same level
		for (const [dx, dy] of DIRECTIONS_8) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;

			// Skip cells occupied by other tokens
			if (blocked_cells?.has(`${nx},${ny}`)) continue;

			if (dx && dy) {
				// Diagonal move: check both component edges
				// Prevents corner-cutting through walls
				if (_is_edge_blocked(blocked_edges, x, y, x + dx, y)) continue;
				if (_is_edge_blocked(blocked_edges, x + dx, y, x + dx, y + dy)) continue;
				if (_is_edge_blocked(blocked_edges, x, y, x, y + dy)) continue;
				if (_is_edge_blocked(blocked_edges, x, y + dy, x + dx, y + dy)) continue;
				// Key-gated checks for diagonal
				if (is_key_blocked(x, y, x + dx, y)) continue;
				if (is_key_blocked(x + dx, y, x + dx, y + dy)) continue;
				if (is_key_blocked(x, y, x, y + dy)) continue;
				if (is_key_blocked(x, y + dy, x + dx, y + dy)) continue;
			} else if (dx) {
				// Horizontal move
				if (_is_edge_blocked(blocked_edges, x, y, nx, y)) continue;
				if (is_key_blocked(x, y, nx, y)) continue;
			} else {
				// Vertical move
				if (_is_edge_blocked(blocked_edges, x, y, x, ny)) continue;
				if (is_key_blocked(x, y, x, ny)) continue;
			}

			const base_cost = dx && dy ? 1.414 : 1;
			const terrain_cost = terrain_cost_map?.get(`${nx},${ny}`) ?? 1;
			neighbors.push({ x: nx, y: ny, level: level_id, cost: base_cost * terrain_cost });
		}

		// Vertical transitions at stairs cells
		const key = `${x},${y},${level_id}`;
		if (stairs_cells.has(key)) {
			for (const target_level of stairs_cells.get(key)) {
				const target_grid = grids[target_level];
				if (!target_grid) continue;
				neighbors.push({ x, y, level: target_level, cost: 1 });
			}
		}

		return neighbors;
	}

	/**
	 * Compute a set of occupied nav-cell keys per level for all tokens in the scene.
	 *
	 * Tokens are treated as dynamic obstacles — this is computed at query time, not
	 * cached in the grid, because tokens move frequently. The wall grid cache
	 * (walls/regions/doors) is unaffected.
	 *
	 * Self-exclusion: the pathing NPC's own token (exclude_token_id) is NOT blocked,
	 * so A* can start from its current cell and path outward. The NPC's own
	 * footprint is not an obstacle to itself.
	 *
	 * Skips: hidden tokens (if not blockable), and tokens on a different elevation
	 * than the level being queried (handled by the per-level Set).
	 *
	 * @param {Scene} scene
	 * @param {number} cell_size — nav cell size in pixels
	 * @param {number} gw — grid width in nav cells
	 * @param {number} gh — grid height in nav cells
	 * @param {string|null} exclude_token_id — token id to exclude from blocking
	 * @returns {Map<string, Set<string>>} level_id → Set of "x,y" occupied nav-cell keys
	 */
	_rasterize_token_cells(token, scene, cell_size, gw, gh) {
		const level_id = token._source.level ?? scene.levels.contents[0]?.id ?? '_default';
		const cells = new Set();
		const grid_size = scene.grid.size;
		const tw = token.width ?? 1;
		const th = token.height ?? 1;
		const px_w = tw * grid_size;
		const px_h = th * grid_size;
		const start_cx = Math.floor(token.x / cell_size);
		const start_cy = Math.floor(token.y / cell_size);
		const end_cx = Math.ceil((token.x + px_w) / cell_size);
		const end_cy = Math.ceil((token.y + px_h) / cell_size);

		for (let cy = start_cy; cy < end_cy && cy < gh; cy++) {
			if (cy < 0) continue;
			for (let cx = start_cx; cx < end_cx && cx < gw; cx++) {
				if (cx < 0) continue;
				cells.add(`${cx},${cy}`);
			}
		}
		return { level_id, cells };
	}

	_get_full_token_cells_by_level(scene, cell_size, gw, gh) {
		if (
			this._token_cells_cache
			&& this._token_cells_cache.scene_id === scene.id
			&& this._token_cells_cache.tick_id === this._tick_id
		) {
			return this._token_cells_cache.by_level;
		}

		const by_level = new Map();
		const by_token = new Map();

		for (const token of scene.tokens) {
			if (token.hidden) continue;
			const { level_id, cells } = this._rasterize_token_cells(token, scene, cell_size, gw, gh);
			if (!cells.size) continue;
			if (!by_level.has(level_id)) by_level.set(level_id, new Set());
			const level_cells = by_level.get(level_id);
			for (const key of cells) level_cells.add(key);
			by_token.set(token.id, { level_id, cells });
		}

		this._token_cells_cache = {
			scene_id: scene.id,
			tick_id: this._tick_id,
			by_level,
			by_token,
		};
		return by_level;
	}

	_get_token_cells_by_level(scene, cell_size, gw, gh, exclude_token_id = null) {
		if (!game.settings.get(MODULE_ID, "block_tokens")) return new Map();

		const full = this._get_full_token_cells_by_level(scene, cell_size, gw, gh);
		if (!exclude_token_id) return full;

		const excluded = this._token_cells_cache?.by_token?.get(exclude_token_id);
		if (!excluded) return full;

		const result = new Map();
		for (const [level_id, cells] of full) {
			const copy = new Set(cells);
			if (level_id === excluded.level_id) {
				for (const key of excluded.cells) copy.delete(key);
			}
			result.set(level_id, copy);
		}
		return result;
	}

	/** Drop cached token occupancy so the next query uses live positions. */
	invalidate_token_cells_cache() {
		this._token_cells_cache = null;
	}

	/**
	 * Whether another token occupies the grid tile the mover would step onto.
	 * @param {Scene} scene
	 * @param {number} gx — grid-tile X
	 * @param {number} gy — grid-tile Y
	 * @param {string} level_id
	 * @param {string|null} exclude_token_id — moving token (for footprint size + self skip)
	 * @returns {boolean}
	 */
	is_grid_tile_occupied(scene, gx, gy, level_id, exclude_token_id = null) {
		if (!game.settings.get(MODULE_ID, "block_tokens")) return false;

		this.invalidate_token_cells_cache();

		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return false;

		const grid = scene.grid.size;
		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw;
		const gh = grid_data.gh;
		const target_level = level_id ?? this._default_level(scene);

		const mover = exclude_token_id ? scene.tokens.get(exclude_token_id) : null;
		const tw = mover?.width ?? 1;
		const th = mover?.height ?? 1;
		const px = gx * grid;
		const py = gy * grid;
		const px_w = tw * grid;
		const px_h = th * grid;

		const dest_cells = new Set();
		const start_cx = Math.floor(px / cell_size);
		const start_cy = Math.floor(py / cell_size);
		const end_cx = Math.ceil((px + px_w) / cell_size);
		const end_cy = Math.ceil((py + px_h) / cell_size);
		for (let cy = start_cy; cy < end_cy && cy < gh; cy++) {
			if (cy < 0) continue;
			for (let cx = start_cx; cx < end_cx && cx < gw; cx++) {
				if (cx < 0) continue;
				dest_cells.add(`${cx},${cy}`);
			}
		}
		if (!dest_cells.size) return false;

		this._get_full_token_cells_by_level(scene, cell_size, gw, gh);
		const by_token = this._token_cells_cache?.by_token;
		if (!by_token) return false;

		for (const [token_id, info] of by_token) {
			if (token_id === exclude_token_id) continue;
			if (info.level_id !== target_level) continue;
			for (const key of dest_cells) {
				if (info.cells.has(key)) return true;
			}
		}
		return false;
	}

	_default_level(scene) {
		return scene.levels.contents[0]?.id ?? '_default';
	}
}

// ── Helper Functions ──────────────────────────────────────────────

function _wall_affects_level(wall, level) {
	// Foundry V14: wall.levels is a Set of Level document IDs.
	// If empty, the wall affects all levels (matches Foundry's #getIncludingLevels).
	// If non-empty, the wall only affects the specified levels.
	if (!wall.levels || wall.levels.size === 0) return true;
	return wall.levels.has(level.id);
}

function _heuristic(ax, ay, bx, by, level_a, level_b) {
	// Octile distance (screen-space) + level penalty.
	// When source and destination are on different levels, the NPC must
	// reach a stair cell first. We add a penalty proportional to the
	// level difference so A* deprioritizes same-level dead-ends and seeks
	// stairs earlier. The penalty is a large constant per level hop —
	// admissible because traversing a stair costs at least 1 cell and
	// the path must detour to a stairwell.
	const dx = Math.abs(ax - bx);
	const dy = Math.abs(ay - by);
	const octile = (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
	if (level_a != null && level_b != null && level_a !== level_b) {
		return octile + 1000;
	}
	return octile;
}

/**
 * Admissible heuristic for multi-goal (region / door-approach) search.
 *
 * Returns the minimum octile distance from a cell to any goal cell, plus the
 * level penalty when the goal lives on another level. This makes the search
 * directed A* (aims at the nearest goal region) instead of Dijkstra, which
 * would expand uniformly in all directions and sweep the entire grid for a
 * distant goal — the cause of "distant targets never resolve" for multi-goal
 * paths (move_to_region / wander / door_interact).
 *
 * @param {{x:number, y:number, level:string}} nb
 * @param {Array<{x:number, y:number, level:string}>|undefined} goal_list
 * @returns {number}
 */
function _multi_goal_heuristic(nb, goal_list) {
	if (!goal_list?.length) return 0;
	let best = Infinity;
	for (let i = 0; i < goal_list.length; i++) {
		const g = goal_list[i];
		const h = _heuristic(nb.x, nb.y, g.x, g.y, nb.level, g.level);
		if (h < best) best = h;
	}
	return best;
}

function _reconstruct_path(came_from, end_key, grid_data) {
	// Build the raw path in nav-cell coordinates
	const raw_path = [];
	let key = end_key;
	while (key) {
		const [x, y, level] = key.split(',');
		raw_path.unshift({ x: parseInt(x), y: parseInt(y), level_id: level });
		key = came_from.get(key);
	}

	// Convert nav-cell coords to grid-tile coords. We keep every nav-cell
	// step that crosses a grid-tile boundary as a waypoint and skip the
	// intermediate nav cells that fall within the same grid tile.
	//
	// This gives exactly one waypoint per grid tile moved — the token
	// advances 1 square per tick, whether orthogonal or diagonal.
	//
	// No collapsing is performed: Foundry's token.animate() interpolates
	// smoothly between consecutive 1-tile waypoints.
	const nav_res = grid_data.nav_resolution ?? 1;

	// Skip the first element (source cell) to avoid a wasted no-op tick
	const start_idx = raw_path.length > 1 ? 1 : 0;

	const raw_grid = [];
	let prev_gx = null, prev_gy = null;

	for (let si = start_idx; si < raw_path.length; si++) {
		const step = raw_path[si];
		const sx = Math.floor(step.x / nav_res);
		const sy = Math.floor(step.y / nav_res);

		// Skip nav cells that haven't crossed into a new grid tile
		if (prev_gx === sx && prev_gy === sy) continue;

		raw_grid.push({ x: sx, y: sy, level_id: step.level_id });
		prev_gx = sx;
		prev_gy = sy;
	}

	// Collapse staircase patterns into clean diagonals.
	//
	// A* at nav-cell resolution can produce staircase paths like
	// (0,0)→(0,1)→(1,1)→(1,2)→(2,2) even when a clean diagonal
	// (0,0)→(1,1)→(2,2) is available and wall-free. After boundary-cross
	// filtering these become grid-tile staircases. We post-process to
	// collapse L-shaped pairs (two orthogonal steps that form a diagonal)
	// into a single diagonal step, provided the diagonal is not blocked.
	return _collapse_staircases(raw_grid, grid_data);
}

/**
 * Collapse staircase patterns in a grid-tile path into clean diagonals.
 *
 * A* at nav-cell resolution can produce L-shaped staircase patterns at
 * the grid-tile level, e.g. (0,0)→(0,1)→(1,1) instead of (0,0)→(1,1).
 * This function detects consecutive orthogonal steps that form an L-shape
 * and replaces them with a single diagonal step when the diagonal move
 * is not blocked by walls.
 *
 * The wall check uses the nav-cell blocked_edges at the grid-tile boundary
 * corner — the same corner-cutting check A* uses, but at the nav-cell level
 * where the two grid tiles meet.
 */
function _collapse_staircases(grid_path, grid_data) {
	if (grid_path.length < 3) return grid_path;

	const { grids, nav_resolution } = grid_data;
	const nav_res = nav_resolution ?? 1;

	const result = [grid_path[0]];

	let i = 1;
	while (i < grid_path.length) {
		const prev = result[result.length - 1];
		const cur = grid_path[i];

		// Check if we can collapse prev→cur→next into prev→next (a diagonal)
		if (i + 1 < grid_path.length) {
			const next = grid_path[i + 1];
			const dx1 = cur.x - prev.x;
			const dy1 = cur.y - prev.y;
			const dx2 = next.x - cur.x;
			const dy2 = next.y - cur.y;

			// Check for L-shape: two orthogonal steps that form a diagonal
			const is_l_shape =
				(Math.abs(dx1) === 1 && dy1 === 0 && dx2 === 0 && Math.abs(dy2) === 1) ||
				(dx1 === 0 && Math.abs(dy1) === 1 && Math.abs(dx2) === 1 && dy2 === 0);

			if (is_l_shape && prev.level_id === cur.level_id && cur.level_id === next.level_id) {
				const diag_dx = next.x - prev.x;
				const diag_dy = next.y - prev.y;

				// Check if the diagonal move is wall-free at the nav-cell boundary
				if (_is_diagonal_clear(prev.x, prev.y, diag_dx, diag_dy, prev.level_id, grids, nav_res)) {
					// Collapse: skip cur, go directly to next
					result.push(next);
					i += 2;
					continue;
				}
			}
		}

		result.push(cur);
		i++;
	}

	return result;
}

/**
 * Check if a diagonal grid-tile move from (gx,gy) by (dx,dy) is wall-free.
 *
 * The diagonal crosses a grid-tile boundary at the nav-cell corner where
 * the two tiles meet. We check the nav-cell edges at that corner using
 * the same corner-cutting check A* uses.
 */
function _is_diagonal_clear(gx, gy, dx, dy, level_id, grids, nav_res) {
	const blocked_edges = grids[level_id] ?? grids['_default'];
	if (!blocked_edges) return false;

	// The nav-cell at the grid-tile corner where the diagonal crosses
	const corner_nx = gx * nav_res + (dx > 0 ? nav_res - 1 : 0);
	const corner_ny = gy * nav_res + (dy > 0 ? nav_res - 1 : 0);

	// Same corner-cutting check as A* _get_neighbors for diagonal moves:
	// both component edges must be clear
	if (_is_edge_blocked(blocked_edges, corner_nx, corner_ny, corner_nx + dx, corner_ny)) return false;
	if (_is_edge_blocked(blocked_edges, corner_nx + dx, corner_ny, corner_nx + dx, corner_ny + dy)) return false;
	if (_is_edge_blocked(blocked_edges, corner_nx, corner_ny, corner_nx, corner_ny + dy)) return false;
	if (_is_edge_blocked(blocked_edges, corner_nx, corner_ny + dy, corner_nx + dx, corner_ny + dy)) return false;

	return true;
}

// ── Min Heap (binary priority queue) ─────────────────────────────

class MinHeap {
	constructor() { this._items = []; }
	get size() { return this._items.length; }
	push(item) {
		this._items.push(item);
		this._bubble_up(this._items.length - 1);
	}
	pop() {
		if (!this._items.length) return null;
		const min = this._items[0];
		const last = this._items.pop();
		if (this._items.length) { this._items[0] = last; this._bubble_down(0); }
		return min;
	}
	_bubble_up(i) {
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (this._items[i].f < this._items[parent].f) {
				[this._items[i], this._items[parent]] = [this._items[parent], this._items[i]];
				i = parent;
			} else break;
		}
	}
	_bubble_down(i) {
		while (true) {
			const l = 2 * i + 1, r = 2 * i + 2;
			let min = i;
			if (l < this._items.length && this._items[l].f < this._items[min].f) min = l;
			if (r < this._items.length && this._items[r].f < this._items[min].f) min = r;
			if (min !== i) {
				[this._items[i], this._items[min]] = [this._items[min], this._items[i]];
				i = min;
			} else break;
		}
	}
}