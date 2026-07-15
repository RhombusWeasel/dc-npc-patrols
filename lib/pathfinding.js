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

	// Multi-goal A*
	// Used by action_move_to_region. Expands outward from source, stops when any
	// cell inside the target region is dequeued — gives the shortest wall-aware path.
	// Works across levels: if the region spans stairs cells (changeLevel behaviors),
	// the pathfinder navigates between floors automatically.
	find_path_to_region(scene, source, region_name) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const region = scene.regions.find(r => r.name === region_name);
		if (!region) {
			console.warn(`[dc-npc-patrols] find_path_to_region: region "${region_name}" not found on scene. Available regions:`, scene.regions.map(r => r.name));
			return null;
		}

		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw, gh = grid_data.gh;

		// Collect all cells inside the region as goal cells.
		// Include the region's level(s) so A* only considers the goal reached
		// when on the correct level — prevents matching the x/y on the wrong level.
		const region_cells = _get_region_cells(region, gw, gh, cell_size);
		if (!region_cells.length) {
			console.warn(`[dc-npc-patrols] find_path_to_region: region "${region_name}" has 0 grid cells. Region shapes:`, region.shapes?.map(s => s.type));
			return null;
		}

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
			let walls_processed = 0, walls_skipped = 0;
			for (const wall of scene.walls) {
				// Skip walls that don't block movement (move === NONE)
				if (wall.move === CONST.WALL_MOVEMENT_TYPES.NONE) { walls_skipped++; continue; }
				// Skip open doors — NPCs can walk through
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.OPEN) { walls_skipped++; continue; }
				// Skip closed doors — NPCs can open them
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.CLOSED) { walls_skipped++; continue; }
				// Block: solid walls (NORMAL) and locked doors
				walls_processed++;
				_rasterize_wall(blocked_edges, gw, gh, wall.c, cell_size);
			}
			console.log(`[dc-npc-patrols] Grid built (single-level): ${gw}x${gh}, cell_size=${cell_size}, nav_res=${nav_res}, walls_processed=${walls_processed}, walls_skipped=${walls_skipped}, blocked_edges=${blocked_edges.size}`);
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
			let walls_rasterized = 0;
			for (const wall of scene.walls) {
				// Skip walls that don't block movement (move === NONE)
				if (wall.move === CONST.WALL_MOVEMENT_TYPES.NONE) continue;
				// Skip open doors — NPCs can walk through
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
				// Skip closed doors — NPCs can open them
				if (wall.door > 0 && wall.ds === CONST.WALL_DOOR_STATES.CLOSED) continue;
				// Block: solid walls (NORMAL) and locked doors
				if (!_wall_affects_level(wall, level)) continue;
				walls_rasterized++;
				_rasterize_wall(blocked_edges, gw, gh, wall.c, cell_size);
			}
			console.log(`[dc-npc-patrols] Level ${level.id}: ${walls_rasterized} walls rasterized, ${blocked_edges.size} blocked edges`);
			grids[level.id] = blocked_edges;
		}

		// Stairs: auto-detect changeLevel region behaviors
		const stairs_cells = new Map();
		let stairs_found = 0;
		for (const region of scene.regions) {
			const has_change_level = region.behaviors.some(b => b.type === "changeLevel");
			if (!has_change_level) continue;
			stairs_found++;

			// Region.levels tells us which levels this connects
			// Empty levels set = connects ALL levels; otherwise connects the listed ones
			const connected = region.levels.size
				? [...region.levels]
				: levels.map(l => l.id);

			console.log(`[dc-npc-patrols] Stairs region "${region.name}": connected levels =`, connected, `levels.size =`, region.levels.size);

			const cells = _get_region_cells(region, gw, gh, cell_size);
			console.log(`[dc-npc-patrols] Stairs region "${region.name}": ${cells.length} cells found`);

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

		console.log(`[dc-npc-patrols] Grid built: ${gw}x${gh}, cell_size=${cell_size}, nav_res=${nav_res}, levels=${levels.map(l => l.id).join(',')}, stairs_found=${stairs_found}, stairs_cells=${stairs_cells.size}`);

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

		// Debug: log source cell status
		const src_edges = grids[src_level] ?? grids['_default'];
		console.log(`[dc-npc-patrols] _a_star_multi_goal: start=(${sx},${sy},${src_level}), edges=${src_edges?.size ?? 0}, goals=${goal_cells.size}, grids=${Object.keys(grids).join(',')}`);

		// Diagnostic: dump blocked edges near start cell (within 5 cells)
		if (src_edges) {
			const nearby = [];
			for (let ex = sx - 5; ex <= sx + 5; ex++) {
				for (let ey = sy - 5; ey <= sy + 5; ey++) {
					if (ex < 0 || ex >= gw || ey < 0 || ey >= gh) continue;
					if (ex + 1 < gw && _is_edge_blocked(src_edges, ex, ey, ex + 1, ey)) nearby.push(`${ex},${ey}→${ex+1},${ey}`);
					if (ey + 1 < gh && _is_edge_blocked(src_edges, ex, ey, ex, ey + 1)) nearby.push(`${ex},${ey}→${ex},${ey+1}`);
				}
			}
			console.log(`[dc-npc-patrols] _a_star_multi_goal: ${nearby.length} blocked edges near start (±5 cells):`, nearby.slice(0, 50).join(', '));
		}

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
		console.log(`[dc-npc-patrols] _a_star_multi_goal: exhausted all cells without finding goal. explored=${g_score.size} cells`);

		// Diagnostic: log closest explored cell to any goal
		let closest = null, closest_dist = Infinity;
		for (const key of g_score.keys()) {
			const parts = key.split(',');
			const x = parseInt(parts[0]), y = parseInt(parts[1]);
			for (const g of goal_cells) {
				const gparts = g.split(',');
				const gx = parseInt(gparts[0]), gy = parseInt(gparts[1]);
				const d = Math.abs(x - gx) + Math.abs(y - gy);
				if (d < closest_dist) { closest_dist = d; closest = { cell: key, goal: g, dist: d }; }
			}
		}
		if (closest) console.log(`[dc-npc-patrols] _a_star_multi_goal: closest explored cell to goal: ${closest.cell} → goal ${closest.goal}, dist=${closest.dist}`);

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

	// If nav_resolution is 1, raw nav coords ARE grid coords.
	// Snap each waypoint to the top-left corner of the nearest Foundry
	// grid tile (tokens are positioned by top-left, not center).
	const nav_res = grid_data.nav_resolution ?? 1;
	if (nav_res === 1) {
		if (raw_path.length > 1) raw_path.shift();
		for (const wp of raw_path) {
			wp.x = Math.floor(wp.x);
			wp.y = Math.floor(wp.y);
		}
		return raw_path;
	}

	// Convert nav-cell coords to grid coords (floating point).
	// Collapse consecutive steps that move in the same direction into
	// single waypoints, so the token animates in straight line segments
	// between turns. Each segment was verified wall-free by A* at
	// nav-cell resolution, so animating in a straight line between
	// waypoints cannot cross walls.
	const path = [];
	let prev_gx = null, prev_gy = null;
	let last_dir_x = null, last_dir_y = null;

	// Skip the first element (source cell) to avoid a wasted no-op tick
	const start_idx = 1;

	for (let si = start_idx; si < raw_path.length; si++) {
		const step = raw_path[si];
		const gx = step.x / nav_res;
		const gy = step.y / nav_res;

		// Snap to top-left corner of nearest Foundry grid tile
		const sx = Math.floor(gx);
		const sy = Math.floor(gy);

		if (prev_gx !== null) {
			const dir_x = Math.sign(sx - prev_gx);
			const dir_y = Math.sign(sy - prev_gy);

			// If same direction as last step, replace the last waypoint
			// (extend the straight line segment)
			if (path.length > 0 && dir_x === last_dir_x && dir_y === last_dir_y) {
				path[path.length - 1] = { x: sx, y: sy, level_id: step.level_id };
				prev_gx = sx;
				prev_gy = sy;
				continue;
			}

			last_dir_x = dir_x;
			last_dir_y = dir_y;
		}

		path.push({ x: sx, y: sy, level_id: step.level_id });
		prev_gx = sx;
		prev_gy = sy;
	}

	return path;
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