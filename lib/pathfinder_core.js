/**
 * pathfinder_core.js — Pure, self-contained A* pathfinding solver.
 *
 * This module has NO dependencies on Foundry VTT, game state, or the BT
 * engine. It operates entirely on a serialized nav grid and query payload so
 * it can run inside a Web Worker without any global objects.
 *
 * The search is a single-pass, unbudgeted A* run. The main thread's job is to
 * build the grid, serialize it once per scene, and hand off individual
 * queries; the worker executes the search off-thread so long-distance paths
 * never block the GM's UI thread.
 */

const DIRECTIONS_8 = [
	[-1, -1], [0, -1], [1, -1],
	[-1, 0],           [1, 0],
	[-1, 1], [0, 1], [1, 1],
];

/**
 * Normalized edge key between two adjacent nav cells.
 */
function edge_key(x1, y1, x2, y2) {
	let a, b;
	if (x1 < x2 || (x1 === x2 && y1 <= y2)) {
		a = `${x1},${y1}`;
		b = `${x2},${y2}`;
	} else {
		a = `${x2},${y2}`;
		b = `${x1},${y1}`;
	}
	return `${a}>${b}`;
}

/** Check if the edge between two adjacent cells is blocked. */
function _is_edge_blocked(blocked_edges, x1, y1, x2, y2) {
	return blocked_edges.has(edge_key(x1, y1, x2, y2));
}

/**
 * Octile-distance heuristic with a per-level-hop penalty so multi-level
 * searches deprioritize same-level dead-ends and seek stairs earlier.
 */
function _heuristic(ax, ay, bx, by, level_a, level_b) {
	const dx = Math.abs(ax - bx);
	const dy = Math.abs(ay - by);
	const octile = (dx + dy) + (1.414 - 2) * Math.min(dx, dy);
	if (level_a != null && level_b != null && level_a !== level_b) {
		return octile + 1000;
	}
	return octile;
}

/**
 * Minimum octile distance from a cell to any goal cell, plus the level
 * penalty when the goal lives on another level. Directed (multi-goal) A*
 * instead of Dijkstra — essential for distant region / door targets.
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
	const raw_path = [];
	let key = end_key;
	while (key) {
		const [x, y, level] = key.split(',');
		raw_path.unshift({ x: parseInt(x, 10), y: parseInt(y, 10), level_id: level });
		key = came_from.get(key);
	}

	const nav_res = grid_data.nav_resolution ?? 1;

	// Skip the first element (source cell) to avoid a wasted no-op tick.
	const start_idx = raw_path.length > 1 ? 1 : 0;

	const raw_grid = [];
	let prev_gx = null, prev_gy = null;

	for (let si = start_idx; si < raw_path.length; si++) {
		const step = raw_path[si];
		const sx = Math.floor(step.x / nav_res);
		const sy = Math.floor(step.y / nav_res);
		if (prev_gx === sx && prev_gy === sy) continue;
		raw_grid.push({ x: sx, y: sy, level_id: step.level_id });
		prev_gx = sx;
		prev_gy = sy;
	}

	return _collapse_staircases(raw_grid, grid_data);
}

/**
 * Collapse L-shaped (two orthogonal) grid-tile steps into a clean diagonal
 * when the diagonal is wall-free.
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

		if (i + 1 < grid_path.length) {
			const next = grid_path[i + 1];
			const dx1 = cur.x - prev.x;
			const dy1 = cur.y - prev.y;
			const dx2 = next.x - cur.x;
			const dy2 = next.y - cur.y;

			const is_l_shape =
				(Math.abs(dx1) === 1 && dy1 === 0 && dx2 === 0 && Math.abs(dy2) === 1) ||
				(dx1 === 0 && Math.abs(dy1) === 1 && Math.abs(dx2) === 1 && dy2 === 0);

			if (is_l_shape && prev.level_id === cur.level_id && cur.level_id === next.level_id) {
				const diag_dx = next.x - prev.x;
				const diag_dy = next.y - prev.y;
				if (_is_diagonal_clear(prev.x, prev.y, diag_dx, diag_dy, prev.level_id, grids, nav_res)) {
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

/** Check a diagonal grid-tile move is wall-free at the corner boundary. */
function _is_diagonal_clear(gx, gy, dx, dy, level_id, grids, nav_res) {
	const blocked_edges = grids[level_id] ?? grids['_default'];
	if (!blocked_edges) return false;

	const corner_nx = gx * nav_res + (dx > 0 ? nav_res - 1 : 0);
	const corner_ny = gy * nav_res + (dy > 0 ? nav_res - 1 : 0);

	if (_is_edge_blocked(blocked_edges, corner_nx, corner_ny, corner_nx + dx, corner_ny)) return false;
	if (_is_edge_blocked(blocked_edges, corner_nx + dx, corner_ny, corner_nx + dx, corner_ny + dy)) return false;
	if (_is_edge_blocked(blocked_edges, corner_nx, corner_ny, corner_nx, corner_ny + dy)) return false;
	if (_is_edge_blocked(blocked_edges, corner_nx, corner_ny + dy, corner_nx + dx, corner_ny + dy)) return false;

	return true;
}

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

/**
 * Compute the list of walkable neighbors for a nav cell. Handles blocked
 * edges, token occupancy, key-gated doors, terrain cost, and stairs.
 *
 * @param {object} grid_data — serialized nav grid
 * @param {number} x
 * @param {number} y
 * @param {string} level_id
 * @param {Map<string, Set<string>>|null} blocked_by_level — level → Set<'x,y'>
 * @param {string} scene_id
 * @param {Set<string>|null} key_uuids
 */
function _get_neighbors(x, y, level_id, grid_data, blocked_by_level = null, scene_id = null, key_uuids = null) {
	const { grids, stairs_cells, gw, gh } = grid_data;
	const neighbors = [];
	const blocked_edges = grids[level_id] ?? grids['_default'];
	const blocked_cells = blocked_by_level?.get(level_id) ?? null;
	const key_gated = grid_data.key_gated_edges?.[level_id];
	const terrain_cost_map = grid_data.terrain_costs?.get(level_id);

	const is_key_blocked = (x1, y1, x2, y2) => {
		if (!key_gated?.size) return false;
		const ekey = edge_key(x1, y1, x2, y2);
		const wall_id = key_gated.get(ekey) ?? key_gated.get(edge_key(x2, y2, x1, y1));
		if (!wall_id) return false;
		const wall_uuid = `Scene.${scene_id}.Wall.${wall_id}`;
		return !key_uuids?.has(wall_uuid);
	};

	for (const [dx, dy] of DIRECTIONS_8) {
		const nx = x + dx, ny = y + dy;
		if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
		if (blocked_cells?.has(`${nx},${ny}`)) continue;

		if (dx && dy) {
			if (_is_edge_blocked(blocked_edges, x, y, x + dx, y)) continue;
			if (_is_edge_blocked(blocked_edges, x + dx, y, x + dx, y + dy)) continue;
			if (_is_edge_blocked(blocked_edges, x, y, x, y + dy)) continue;
			if (_is_edge_blocked(blocked_edges, x, y + dy, x + dx, y + dy)) continue;
			if (is_key_blocked(x, y, x + dx, y)) continue;
			if (is_key_blocked(x + dx, y, x + dx, y + dy)) continue;
			if (is_key_blocked(x, y, x, y + dy)) continue;
			if (is_key_blocked(x, y + dy, x + dx, y + dy)) continue;
		} else if (dx) {
			if (_is_edge_blocked(blocked_edges, x, y, nx, y)) continue;
			if (is_key_blocked(x, y, nx, y)) continue;
		} else {
			if (_is_edge_blocked(blocked_edges, x, y, x, ny)) continue;
			if (is_key_blocked(x, y, x, ny)) continue;
		}

		const base_cost = dx && dy ? 1.414 : 1;
		const terrain_cost = terrain_cost_map?.get(`${nx},${ny}`) ?? 1;
		neighbors.push({ x: nx, y: ny, level: level_id, cost: base_cost * terrain_cost });
	}

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
 * Run a single unbudgeted A* search to completion.
 *
 * @param {object} grid_data — serialized nav grid (grids, stairs_cells,
 *   terrain_costs, key_gated_edges, gw, gh, nav_resolution)
 * @param {object} q — query:
 *   { src_x, src_y, src_level } source nav cell
 *   For point goals: { goal_x, goal_y, goal_level }
 *   For goal-cell sets: { goal_cells: Set<'x,y,level'> }
 *   Also: { blocked_by_level: Map|null, key_uuids: Set|null, scene_id }
 * @returns {object[]|null} grid-tile path (or null if unreachable)
 */
export function solve_path(grid_data, q) {
	const open = new MinHeap();
	const came_from = new Map();
	const g_score = new Map();
	const closed = new Set();

	const start_key = `${q.src_x},${q.src_y},${q.src_level}`;
	g_score.set(start_key, 0);

	let is_multi;
	let goal_key = null;
	let goal_list = null;

	if (q.goal_cells != null) {
		is_multi = true;
		goal_list = [];
		for (const key of q.goal_cells) {
			const parts = key.split(',');
			if (parts.length >= 2) {
				goal_list.push({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10), level: parts[2] });
			}
		}
		open.push({ x: q.src_x, y: q.src_y, level: q.src_level, f: 0 });
	} else {
		is_multi = false;
		goal_key = `${q.goal_x},${q.goal_y},${q.goal_level}`;
		open.push({
			x: q.src_x, y: q.src_y, level: q.src_level,
			f: _heuristic(q.src_x, q.src_y, q.goal_x, q.goal_y, q.src_level, q.goal_level),
		});
	}

	const blocked_by_level = q.blocked_by_level ?? null;
	const key_uuids = q.key_uuids ?? null;
	const scene_id = q.scene_id ?? null;

	while (open.size > 0) {
		const current = open.pop();
		const cur_key = `${current.x},${current.y},${current.level}`;
		if (closed.has(cur_key)) continue;
		closed.add(cur_key);

		const is_goal = is_multi
			? q.goal_cells.has(cur_key)
			: cur_key === goal_key;
		if (is_goal) {
			return _reconstruct_path(came_from, cur_key, grid_data);
		}

		const neighbors = _get_neighbors(
			current.x, current.y, current.level, grid_data, blocked_by_level, scene_id, key_uuids,
		);
		for (const nb of neighbors) {
			const nb_key = `${nb.x},${nb.y},${nb.level}`;
			const tentative_g = (g_score.get(cur_key) ?? Infinity) + nb.cost;
			if (tentative_g < (g_score.get(nb_key) ?? Infinity)) {
				came_from.set(nb_key, cur_key);
				g_score.set(nb_key, tentative_g);
				const h = is_multi
					? _multi_goal_heuristic(nb, goal_list)
					: _heuristic(nb.x, nb.y, q.goal_x, q.goal_y, nb.level, q.goal_level);
				open.push({ x: nb.x, y: nb.y, level: nb.level, f: tentative_g + h });
			}
		}
	}

	return null;
}
