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

import { _rasterize_wall, _get_region_cells } from "./utils.js";

const DIRECTIONS_8 = [
	[-1,-1],[0,-1],[1,-1],
	[-1, 0],       [1, 0],
	[-1, 1],[0, 1],[1, 1],
];

export class Pathfinding {
	constructor() {
		this._grid_cache = new Map();   // scene_id → { grids, stairs_cells, ... }
		this._path_cache = new Map();   // scene_id → Map(src_key,dest_key → path)
	}

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
		if (!region) return null;

		const cell_size = grid_data.cell_size;
		const gw = grid_data.gw, gh = grid_data.gh;

		// Collect all cells inside the region as goal cells
		const region_cells = _get_region_cells(region, gw, gh, cell_size);
		const goal_cells = new Set(region_cells.map(c => `${c.x},${c.y}`));
		if (!goal_cells.size) return null;

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

		const levels = scene.levels.contents.sort((a, b) => a.elevation.base - b.elevation.base);
		const cell_size = scene.grid.size;
		const gw = Math.ceil(scene.width / cell_size);
		const gh = Math.ceil(scene.height / cell_size);

		// No levels = single flat grid
		if (!levels.length) {
			const grid = new Uint8Array(gw * gh);
			for (const wall of scene.walls) {
				if (wall.move !== CONST.WALL_MOVEMENT_TYPES.NORMAL) continue;
				if (wall.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
				_rasterize_wall(grid, gw, gh, wall.c, cell_size);
			}
			const result = {
				grids: { _default: grid },
				levels: [{ id: '_default', elevation: { base: scene.elevation ?? 0 } }],
				stairs_cells: new Map(),
				gw, gh, cell_size,
			};
			this._grid_cache.set(scene.id, result);
			return result;
		}

		// Multi-level: one grid per level
		const grids = {};
		for (const level of levels) {
			const grid = new Uint8Array(gw * gh);
			for (const wall of scene.walls) {
				if (wall.move !== CONST.WALL_MOVEMENT_TYPES.NORMAL) continue;
				if (wall.ds === CONST.WALL_DOOR_STATES.OPEN) continue;
				if (!_wall_affects_level(wall, level)) continue;
				_rasterize_wall(grid, gw, gh, wall.c, cell_size);
			}
			grids[level.id] = grid;
		}

		// Stairs: auto-detect changeLevel region behaviors
		const stairs_cells = new Map();
		for (const region of scene.regions) {
			const has_change_level = region.behaviors.some(b => b.type === "changeLevel");
			if (!has_change_level) continue;

			// Region.levels tells us which levels this connects
			// Empty levels set = connects ALL levels; otherwise connects the listed ones
			const connected = region.levels.size
				? [...region._source.levels]
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

		const result = { grids, levels, stairs_cells, gw, gh, cell_size };
		this._grid_cache.set(scene.id, result);
		return result;
	}

	// ── A* Algorithm ───────────────────────────────────────────────

	_a_star(grid_data, sx, sy, src_level, dx, dy, dst_level) {
		const { grids, stairs_cells, gw, gh } = grid_data;
		const open = new MinHeap();
		const came_from = new Map();
		const g_score = new Map();

		const start_key = `${sx},${sy},${src_level}`;
		const goal_key = `${dx},${dy},${dst_level}`;

		g_score.set(start_key, 0);
		open.push({ x: sx, y: sy, level: src_level, f: _heuristic(sx, sy, dx, dy) });

		while (open.size > 0) {
			const current = open.pop();
			const cur_key = `${current.x},${current.y},${current.level}`;

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

		const start_key = `${sx},${sy},${src_level}`;

		g_score.set(start_key, 0);
		open.push({ x: sx, y: sy, level: src_level, f: 0 });

		while (open.size > 0) {
			const current = open.pop();
			const cur_key = `${current.x},${current.y},${current.level}`;

			// Check if current cell is a goal (flat key, ignores level)
			const flat_key = `${current.x},${current.y}`;
			if (goal_cells.has(flat_key)) {
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

		// 8-directional on same level
		for (const [dx, dy] of DIRECTIONS_8) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
			const grid = grids[level_id] ?? grids['_default'];
			if (grid[ny * gw + nx]) continue;  // blocked
			neighbors.push({ x: nx, y: ny, level: level_id, cost: dx && dy ? 1.414 : 1 });
		}

		// Vertical transitions at stairs cells
		const key = `${x},${y},${level_id}`;
		if (stairs_cells.has(key)) {
			for (const target_level of stairs_cells.get(key)) {
				const target_grid = grids[target_level];
				if (!target_grid || target_grid[y * gw + x]) continue;
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
	// Walls without elevation data affect all levels
	const bottom = wall.elevation?.bottom ?? -Infinity;
	const top = wall.elevation?.top ?? Infinity;
	const level_base = level.elevation.base;
	const top_check = wall.elevation?.topInclusive
		? level_base <= top
		: level_base < top;
	return level_base >= bottom && top_check;
}

function _heuristic(ax, ay, bx, by) {
	// Octile distance (screen-space, ignores level — stairs are spatially close)
	const dx = Math.abs(ax - bx);
	const dy = Math.abs(ay - by);
	return (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
}

function _reconstruct_path(came_from, end_key, grid_data) {
	const path = [];
	let key = end_key;
	while (key) {
		const [x, y, level] = key.split(',');
		path.unshift({ x: parseInt(x), y: parseInt(y), level_id: level });
		key = came_from.get(key);
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