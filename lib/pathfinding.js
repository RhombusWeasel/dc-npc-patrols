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

import { _rasterize_wall, _get_region_cells, _is_edge_blocked } from "./utils.js";

const DIRECTIONS_8 = [
	[-1,-1],[0,-1],[1,-1],
	[-1, 0],       [1, 0],
	[-1, 1],[0, 1],[1, 1],
];

export class Pathfinding {
	constructor() {
		this._grid_cache = new Map();   // scene_id → { grids, stairs_cells, ... }
		this._path_cache = new Map();   // scene_id → Map(src_key,dest_key → path)
		this._on_path_callback = null; // optional callback(path) for debug overlay
	}

	/** Set a callback invoked after each successful path computation (for debug overlay) */
	set_on_path_callback(fn) { this._on_path_callback = fn; }

	// Main API: find a path from source to destination
	find_path(scene, source, dest) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const cell_size = grid_data.cell_size;
		const src_x = Math.floor(source.x / cell_size);
		const src_y = Math.floor(source.y / cell_size);
		const src_level = source.level_id ?? this._default_level(scene);
		const dst_x = Math.floor(dest.x / cell_size);
		const dst_y = Math.floor(dest.y / cell_size);
		const dst_level = dest.level_id ?? src_level;

		// Check cache
		const cache_key = `${src_x},${src_y},${src_level}>${dst_x},${dst_y},${dst_level}`;
		const scene_cache = this._path_cache.get(scene.id);
		if (scene_cache?.has(cache_key)) return scene_cache.get(cache_key);

		// Run A*
		const path = this._a_star(grid_data, src_x, src_y, src_level, dst_x, dst_y, dst_level);

		// Cache result
		if (!scene_cache) this._path_cache.set(scene.id, new Map());
		this._path_cache.get(scene.id).set(cache_key, path);

		if (this._on_path_callback) this._on_path_callback(path);

		return path;
	}

	/**
	 * Pick a random grid cell inside a region that is reachable from source.
	 * @returns {{ x: number, y: number, level_id?: string }|null} grid coords
	 */
	pick_random_reachable_cell(scene, source, region_name, max_attempts = 8) {
		const region = scene.regions.find(r => r.name === region_name);
		if (!region) return null;

		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw;
		const gh = grid_data.gh;
		const region_cells = _get_region_cells(region, gw, gh, cell_size);
		if (!region_cells.length) return null;

		const shuffled = region_cells.slice();
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		const attempts = Math.min(max_attempts, shuffled.length);
		const src_level = source.level_id ?? this._default_level(scene);

		for (let i = 0; i < attempts; i++) {
			const cell = shuffled[i];
			const path = this.find_path(
				scene,
				source,
				{
					x: cell.x * cell_size,
					y: cell.y * cell_size,
					level_id: src_level,
				}
			);
			if (path?.length) {
				return { x: cell.x, y: cell.y, level_id: src_level };
			}
		}

		return null;
	}

	// Multi-goal A*
	// Used by action_move_to_region. Expands outward from source, stops when any
	// cell inside the target region is dequeued — gives the shortest wall-aware path.
	// Works across levels: if the region spans stairs cells (changeLevel behaviors),
	// the pathfinder navigates between floors automatically.
	find_path_to_region(scene, source, region_name) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const region = scene.regions.find(r => r.name === region_name);
		if (!region) return null;

		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw, gh = grid_data.gh;

		// Collect all cells inside the region as goal cells.
		// Include the region's level(s) so A* only considers the goal reached
		// when on the correct level — prevents matching the x/y on the wrong level.
		const region_cells = _get_region_cells(region, gw, gh, cell_size);
		if (!region_cells.length) return null;

		// Determine which levels this region is on.
		// region.levels is a Set of Level IDs — if empty, the region is on all levels.
		const all_levels = Object.keys(grid_data.grids);
		const region_levels = region.levels?.size
			? [...region.levels]
			: all_levels;

		// Build level-aware goal keys: "x,y,levelId"
		const goal_cells = new Set();
		for (const cell of region_cells) {
			for (const lvl of region_levels) {
				goal_cells.add(`${cell.x},${cell.y},${lvl}`);
			}
		}

		const src_x = Math.floor(source.x / cell_size);
		const src_y = Math.floor(source.y / cell_size);
		const src_level = source.level_id ?? this._default_level(scene);

		// Check cache
		const cache_key = `${src_x},${src_y},${src_level}>region:${region_name}`;
		const scene_cache = this._path_cache.get(scene.id);
		if (scene_cache?.has(cache_key)) return scene_cache.get(cache_key);

		// Run multi-goal A*
		const path = this._a_star_multi_goal(grid_data, src_x, src_y, src_level, goal_cells);

		// Cache result
		if (!scene_cache) this._path_cache.set(scene.id, new Map());
		this._path_cache.get(scene.id).set(cache_key, path);

		if (this._on_path_callback) this._on_path_callback(path);

		return path;
	}

	// Invalidate caches for a scene (called on wall/region changes)
	invalidate(scene_id) {
		this._grid_cache.delete(scene_id);
		this._path_cache.delete(scene_id);
	}

	// ── Grid Building ─────────────────────────────────────────────

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
			for (const wall of scene.walls) {
				// Skip walls that don't block movement (move === NONE)
				if (wall.move === CONST.WALL_MOVEMENT_TYPES.NONE) continue;
				// Skip open doors — NPCs can walk through
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
				// Skip closed doors — NPCs can open them
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.CLOSED) continue;
				// Block: solid walls (NORMAL) and locked doors
				_rasterize_wall(blocked_edges, gw, gh, wall.c, cell_size);
			}
			const result = {
				grids: { _default: blocked_edges },
				levels: [{ id: '_default', elevation: { base: scene.elevation ?? 0 } }],
				stairs_cells: new Map(),
				gw, gh, cell_size, nav_resolution: nav_res,
			};
			this._grid_cache.set(scene.id, result);
			return result;
		}

		// Multi-level: one grid per level
		const grids = {};
		for (const level of levels) {
			const blocked_edges = new Set();
			for (const wall of scene.walls) {
				// Skip walls that don't block movement (move === NONE)
				if (wall.move === CONST.WALL_MOVEMENT_TYPES.NONE) continue;
				// Skip open doors — NPCs can walk through
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
				// Skip closed doors — NPCs can open them
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.CLOSED) continue;
				// Block: solid walls (NORMAL) and locked doors
				if (!_wall_affects_level(wall, level)) continue;
				_rasterize_wall(blocked_edges, gw, gh, wall.c, cell_size);
			}
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

		const result = { grids, levels, stairs_cells, gw, gh, cell_size, nav_resolution: nav_res };
		this._grid_cache.set(scene.id, result);
		return result;
	}

	// ── A* Algorithm ───────────────────────────────────────────────

	_a_star(grid_data, sx, sy, src_level, dx, dy, dst_level) {
		const { grids, stairs_cells, gw, gh } = grid_data;
		const open = new MinHeap();
		const came_from = new Map();
		const g_score = new Map();
		const closed = new Set();

		const start_key = `${sx},${sy},${src_level}`;
		const goal_key = `${dx},${dy},${dst_level}`;

		g_score.set(start_key, 0);
		open.push({ x: sx, y: sy, level: src_level, f: _heuristic(sx, sy, dx, dy) });

		while (open.size > 0) {
			const current = open.pop();
			const cur_key = `${current.x},${current.y},${current.level}`;

			if (closed.has(cur_key)) continue;
			closed.add(cur_key);

			if (cur_key === goal_key) {
				return _reconstruct_path(came_from, cur_key, grid_data);
			}

			const neighbors = this._get_neighbors(current.x, current.y, current.level, grid_data);
			for (const nb of neighbors) {
				const nb_key = `${nb.x},${nb.y},${nb.level}`;
				const tentative_g = (g_score.get(cur_key) ?? Infinity) + nb.cost;
				if (tentative_g < (g_score.get(nb_key) ?? Infinity)) {
					came_from.set(nb_key, cur_key);
					g_score.set(nb_key, tentative_g);
					const h = _heuristic(nb.x, nb.y, dx, dy);
					open.push({ x: nb.x, y: nb.y, level: nb.level, f: tentative_g + h });
				}
			}
		}
		return null;  // no path found
	}

	// Multi-goal A*: same algorithm but stops when any cell in goal_cells is dequeued.
	_a_star_multi_goal(grid_data, sx, sy, src_level, goal_cells) {
		const { grids, stairs_cells, gw, gh } = grid_data;
		const open = new MinHeap();
		const came_from = new Map();
		const g_score = new Map();
		const closed = new Set();

		const start_key = `${sx},${sy},${src_level}`;

		g_score.set(start_key, 0);
		open.push({ x: sx, y: sy, level: src_level, f: 0 });

		while (open.size > 0) {
			const current = open.pop();
			const cur_key = `${current.x},${current.y},${current.level}`;

			if (closed.has(cur_key)) continue;
			closed.add(cur_key);

			// Check if current cell is a goal (level-aware key)
			if (goal_cells.has(cur_key)) {
				return _reconstruct_path(came_from, cur_key, grid_data);
			}

			const neighbors = this._get_neighbors(current.x, current.y, current.level, grid_data);
			for (const nb of neighbors) {
				const nb_key = `${nb.x},${nb.y},${nb.level}`;
				const tentative_g = (g_score.get(cur_key) ?? Infinity) + nb.cost;
				if (tentative_g < (g_score.get(nb_key) ?? Infinity)) {
					came_from.set(nb_key, cur_key);
					g_score.set(nb_key, tentative_g);
					open.push({ x: nb.x, y: nb.y, level: nb.level, f: tentative_g });
				}
			}
		}
		return null;  // no path found
	}

	_get_neighbors(x, y, level_id, grid_data) {
		const { grids, stairs_cells, gw, gh } = grid_data;
		const neighbors = [];
		const blocked_edges = grids[level_id] ?? grids['_default'];

		// 8-directional on same level
		for (const [dx, dy] of DIRECTIONS_8) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;

			if (dx && dy) {
				// Diagonal move: check both component edges
				// Prevents corner-cutting through walls
				if (_is_edge_blocked(blocked_edges, x, y, x + dx, y)) continue;
				if (_is_edge_blocked(blocked_edges, x + dx, y, x + dx, y + dy)) continue;
				if (_is_edge_blocked(blocked_edges, x, y, x, y + dy)) continue;
				if (_is_edge_blocked(blocked_edges, x, y + dy, x + dx, y + dy)) continue;
			} else if (dx) {
				// Horizontal move
				if (_is_edge_blocked(blocked_edges, x, y, nx, y)) continue;
			} else {
				// Vertical move
				if (_is_edge_blocked(blocked_edges, x, y, x, ny)) continue;
			}

			neighbors.push({ x: nx, y: ny, level: level_id, cost: dx && dy ? 1.414 : 1 });
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

function _heuristic(ax, ay, bx, by) {
	// Octile distance (screen-space, ignores level — stairs are spatially close)
	const dx = Math.abs(ax - bx);
	const dy = Math.abs(ay - by);
	return (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
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