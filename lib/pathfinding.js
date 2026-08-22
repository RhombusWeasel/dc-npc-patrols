/**
 * pathfinding.js — Multi-level A* pathfinding service for wall-aware NPC navigation.
 *
 * Builds a walkability grid from scene walls, auto-detects Foundry's native
 * changeLevel region behaviors for stair transitions between floors — zero
 * extra configuration needed.
 *
 * The grid is built and cached on the main thread (it needs live Foundry
 * state — walls, doors, regions). The A* search itself runs inside a Web
 * Worker (pathfinder_worker.js → pathfinder_core.js) so long-distance searches
 * never block the GM's UI thread. Each search completes in a single pass;
 * there is no budget/slicing/resume machinery because the worker runs
 * off-thread and unbudgeted.
 *
 * Public query methods (find_path, find_path_to_region_doc, find_path_to_wall,
 * pick_random_reachable_cell*) are async and return the finished path. Sync
 * helpers (get_grid_data, is_grid_tile_occupied) stay synchronous.
 */

import { _rasterize_wall, _get_region_cells } from "./utils.js";
import { get_door_approach_cells, create_door_data, register_door } from "./doors.js";
import { find_nearest_region } from "./region_utils.js";

const MODULE_ID = "dc-npc-patrols";

export class Pathfinding {
	constructor() {
		this._grid_cache = new Map();   // scene_id → grid_data (built on main thread)
		this._path_cache = new Map();   // scene_id → Map(cache_key → path)
		this._on_path_callback = null;  // optional callback(path) for debug overlay
		this._tick_id = 0;
		this._tick_scene_id = null;
		this._token_cells_cache = null;
		this._worker = null;            // lazily-created Web Worker
		this._pending = new Map();      // msg_id → { resolve, reject, cache_key, scene_id, grid_data }
		this._seq_id = 0;
		this._sent_grids = new WeakSet(); // grid_data objects already pushed to the worker
	}

	// ── Worker plumbing ──────────────────────────────────────────

	_ensure_worker() {
		if (this._worker) return this._worker;
		const worker = new Worker(new URL("./pathfinder_worker.js", import.meta.url), { type: "module" });
		worker.onmessage = (ev) => {
			const msg = ev.data;
			if (!msg || typeof msg.type !== "string" || msg.type !== "path") return;
			const entry = this._pending.get(msg.id);
			if (!entry) return;
			this._pending.delete(msg.id);
			if (msg.error) {
				entry.reject(new Error(msg.error));
				return;
			}
			// Cache + callback + resolve on the main thread.
			if (entry.cache_key != null) {
				this._store_path_cache(entry.scene_id, entry.cache_key, msg.path);
			}
			if (this._on_path_callback && msg.path) this._on_path_callback(msg.path);
			entry.resolve(msg.path);
		};
		worker.onerror = (err) => {
			console.error(`[${MODULE_ID}] pathfinder worker error:`, err?.message || err);
		};
		this._worker = worker;
		return worker;
	}

	/**
	 * Post a grid to the worker (once per grid build) so find_path queries
	 * can reference it by scene_id.
	 */
	_ensure_grid_sent(grid_data, scene_id) {
		const worker = this._ensure_worker();
		if (this._sent_grids.has(grid_data)) return;
		this._sent_grids.add(grid_data);
		worker.postMessage({ type: "set_grid", scene_id, grid_data });
	}

	/**
	 * Dispatch a search to the worker and await the finished path.
	 * @returns {Promise<object[]|null>}
	 */
	_post_search(scene_id, cache_key, grid_data, query) {
		this._ensure_grid_sent(grid_data, scene_id);
		const worker = this._ensure_worker();
		const id = ++this._seq_id;
		return new Promise((resolve, reject) => {
			this._pending.set(id, {
				resolve,
				reject,
				cache_key,
				scene_id,
			});
			worker.postMessage({ type: "find_path", id, scene_id, query });
		});
	}

	// ── Tick lifecycle (occupancy snapshot invalidation) ───────────

	begin_tick(tick_id, scene) {
		this._tick_id = tick_id;
		this._tick_scene_id = scene?.id ?? null;
		this._token_cells_cache = null;
	}

	end_tick() {
		this._token_cells_cache = null;
	}

	invalidate_tick_caches() {
		this._token_cells_cache = null;
	}

	// ── Path caching (same behaviour as before) ────────────────────

	_get_path_cache_map(scene_id) {
		if (!this._path_cache.has(scene_id)) {
			this._path_cache.set(scene_id, new Map());
		}
		return this._path_cache.get(scene_id);
	}

	_lookup_path_cache(scene_id, cache_key) {
		const map = this._get_path_cache_map(scene_id);
		return map.has(cache_key) ? map.get(cache_key) : undefined;
	}

	_store_path_cache(scene_id, cache_key, path) {
		this._get_path_cache_map(scene_id).set(cache_key, path);
	}

	set_on_path_callback(fn) { this._on_path_callback = fn; }

	/**
	 * Main API: find a path from source to destination. Async — resolves to
	 * the finished path once the worker completes the search.
	 * @param {Scene} scene
	 * @param {{x:number,y:number,level_id?:string}} source
	 * @param {{x:number,y:number,level_id?:string}} dest
	 * @param {object} options — exclude_token_id, key_uuids
	 * @returns {Promise<object[]|null>}
	 */
	async find_path(scene, source, dest, options = {}) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data) return null;

		const cell_size = grid_data.cell_size;
		const src_x = Math.floor(source.x / cell_size);
		const src_y = Math.floor(source.y / cell_size);
		const src_level = source.level_id ?? this._default_level(scene);
		const dst_x = Math.floor(dest.x / cell_size);
		const dst_y = Math.floor(dest.y / cell_size);
		const dst_level = dest.level_id ?? src_level;

		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, grid_data.gw, grid_data.gh, options.exclude_token_id,
		);

		const excl = options.exclude_token_id ?? 'none';
		const has_keys = options.key_uuids?.size ? 'keys' : 'nokeys';
		const cache_key = `${src_x},${src_y},${src_level}>${dst_x},${dst_y},${dst_level}|${excl}|${has_keys}`;

		const cached = this._lookup_path_cache(scene.id, cache_key);
		if (cached !== undefined) return cached;

		return this._post_search(scene.id, cache_key, grid_data, {
			src_x, src_y, src_level,
			goal_x: dst_x, goal_y: dst_y, goal_level: dst_level,
			blocked_by_level,
			key_uuids: options.key_uuids ?? null,
			scene_id: scene.id,
		});
	}

	/**
	 * Pick a random reachable grid cell inside a region. Async (awaits path
	 * checks through find_path).
	 * @returns {Promise<{x:number,y:number,level_id?:string}|null>}
	 */
	async pick_random_reachable_cell(scene, source, region_name, max_attempts = 8, options = {}) {
		const region = find_nearest_region(scene, region_name, source);
		if (!region) return null;
		return this.pick_random_reachable_cell_in_region(scene, source, region, max_attempts, options);
	}

	async pick_random_reachable_cell_in_region(scene, source, region, max_attempts = 8, options = {}) {
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
			const path = await this.find_path(
				scene,
				source,
				{ x: goal.x * cell_size, y: goal.y * cell_size, level_id: goal.level_id },
				options,
			);
			if (path?.length) {
				return { x: goal.x, y: goal.y, level_id: goal.level_id };
			}
		}

		return null;
	}

	// Multi-goal A* (region / door approach) — async.

	async find_path_to_region(scene, source, region_name, options = {}) {
		const region = find_nearest_region(scene, region_name, source);
		if (!region) return null;
		return this.find_path_to_region_doc(scene, source, region, options);
	}

	async find_path_to_region_doc(scene, source, region, options = {}) {
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

		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, gw, gh, options.exclude_token_id,
		);

		const goal_cells = new Set();
		for (const cell of region_cells) {
			for (const lvl of region_levels) {
				const blocked = blocked_by_level.get(lvl);
				if (blocked?.has(`${cell.x},${cell.y}`)) continue;
				goal_cells.add(`${cell.x},${cell.y},${lvl}`);
			}
		}

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

		const cached = this._lookup_path_cache(scene.id, cache_key);
		if (cached !== undefined) return cached;

		const path = await this._post_search(scene.id, cache_key, grid_data, {
			src_x, src_y, src_level,
			goal_cells,
			blocked_by_level,
			key_uuids: options.key_uuids ?? null,
			scene_id: scene.id,
		});

		if (!path?.length) {
			const src_key = `${src_x},${src_y},${src_level}`;
			const src_neighbors = this._count_walkable_neighbors(grid_data, src_x, src_y, src_level, blocked_by_level, scene.id, options.key_uuids ?? null);
			const goal_levels = new Set();
			for (const key of goal_cells) goal_levels.add(key.split(',')[2]);
			const stairs_to_goal = this._stairs_to_levels(grid_data, src_x, src_y, src_level, goal_levels);
			console.warn(
				`[${MODULE_ID}] find_path_to_region_doc: NO PATH region="${region.name}" id=${region.id} ` +
				`src=(${src_x},${src_y},${src_level}) src_neighbors=${src_neighbors} ` +
				`region_levels=[${[...region_levels].join(',')}] goal_cells=${goal_cells.size} goal_levels=[${[...goal_levels].join(',')}] ` +
				`stairs_from_src_to_goal=${stairs_to_goal}`
			);
		}

		return path;
	}

	/** Count walkable neighbors of a nav cell (0 ⇒ source is walled in). */
	_count_walkable_neighbors(grid_data, x, y, level_id, blocked_by_level, scene_id, key_uuids) {
		try {
			const { grids, gw, gh } = grid_data;
			const blocked_edges = grids[level_id] ?? grids['_default'];
			const blocked_cells = blocked_by_level?.get(level_id) ?? null;
			let count = 0;
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					if (!dx && !dy) continue;
					const nx = x + dx, ny = y + dy;
					if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
					if (blocked_cells?.has(`${nx},${ny}`)) continue;
					if (dx && dy) {
						if (blocked_edges.has(`${x},${y}>${x + dx},${y}`)) continue;
						if (blocked_edges.has(`${x + dx},${y}>${x + dx},${y + dy}`)) continue;
						if (blocked_edges.has(`${x},${y}>${x},${y + dy}`)) continue;
						if (blocked_edges.has(`${x},${y + dy}>${x + dx},${y + dy}`)) continue;
					} else if (dx) {
						if (blocked_edges.has(`${x},${y}>${nx},${y}`)) continue;
					} else {
						if (blocked_edges.has(`${x},${y}>${x},${ny}`)) continue;
					}
					count++;
				}
			}
			return count;
		} catch { return -1; }
	}

	/** Whether any stairs cell at the source connects to a goal level. */
	_stairs_to_levels(grid_data, x, y, level_id, goal_levels) {
		try {
			const stairs = grid_data.stairs_cells?.get(`${x},${y},${level_id}`);
			if (!stairs?.length) return false;
			return stairs.some((l) => goal_levels.has(l));
		} catch { return false; }
	}

	// Multi-goal A* to the nearest walkable cell adjacent to a door wall.
	async find_path_to_wall(scene, source, wall, options = {}) {
		const grid_data = this._get_or_build_grid(scene);
		if (!grid_data || !wall) return null;

		const approach_cells = get_door_approach_cells(wall, grid_data);
		if (!approach_cells.length) return null;

		const cell_size = grid_data.cell_size;

		const blocked_by_level = this._get_token_cells_by_level(
			scene, cell_size, grid_data.gw, grid_data.gh, options.exclude_token_id,
		);

		const goal_cells = new Set();
		for (const cell of approach_cells) {
			const blocked = blocked_by_level.get(cell.level_id);
			if (blocked?.has(`${cell.x},${cell.y}`)) continue;
			goal_cells.add(`${cell.x},${cell.y},${cell.level_id}`);
		}
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

		const cached = this._lookup_path_cache(scene.id, cache_key);
		if (cached !== undefined) return cached;

		return this._post_search(scene.id, cache_key, grid_data, {
			src_x, src_y, src_level,
			goal_cells,
			blocked_by_level,
			key_uuids: options.key_uuids ?? null,
			scene_id: scene.id,
		});
	}

	// ── Invalidation ───────────────────────────────────────────────

	/**
	 * Invalidate caches for a scene (called on wall/region changes).
	 * Drops the grid, path cache, and any worker-held grid so the next query
	 * rebuilds and re-sends it.
	 */
	invalidate(scene_id) {
		this._grid_cache.delete(scene_id);
		this._path_cache.delete(scene_id);
		if (this._worker) {
			this._worker.postMessage({ type: "clear_scene", scene_id });
		}
	}

	/** Invalidate only path caches (called on token movement when block_tokens is on). */
	invalidate_paths(scene_id) {
		this._path_cache.delete(scene_id);
	}

	// ── Grid Building (main thread — needs live Foundry state) ─────

	get_grid_data(scene) {
		return this._get_or_build_grid(scene);
	}

	_process_walls_for_level(walls, level_id, gw, gh, cell_size, blocked_edges, door_data) {
		for (const wall of walls) {
			if (wall.move === CONST.WALL_MOVEMENT_TYPES.NONE) continue;

			const is_closed_regular =
				wall.door === CONST.WALL_DOOR_TYPES.DOOR &&
				wall.ds === CONST.WALL_DOOR_STATES.CLOSED;
			const is_open = wall.ds === CONST.WALL_DOOR_STATES.OPEN;

			if (wall.door > 0) {
				// Open doors stay passable but still register approach cells so
				// action_door_interact can path to them to close/lock.
				const gating = is_open ? 'open' : (is_closed_regular ? 'passive' : 'key_gated');
				register_door(door_data, wall.id, level_id, gw, gh, wall.c, cell_size, gating);
			} else {
				_rasterize_wall(blocked_edges, gw, gh, wall.c, cell_size);
			}
		}
	}

	_get_or_build_grid(scene) {
		if (this._grid_cache.has(scene.id)) return this._grid_cache.get(scene.id);

		const nav_res = game.settings.get(MODULE_ID, "nav_resolution") || 1;
		const cell_size = scene.grid.size / nav_res;
		const levels = scene.levels.contents.sort((a, b) => a.elevation.base - b.elevation.base);
		const scene_w = scene.dimensions?.width ?? scene.width;
		const scene_h = scene.dimensions?.height ?? scene.height;
		const gw = Math.ceil(scene_w / cell_size);
		const gh = Math.ceil(scene_h / cell_size);

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

		const stairs_cells = new Map();
		for (const region of scene.regions) {
			const has_change_level = region.behaviors.some(b => b.type === "changeLevel");
			if (!has_change_level) continue;

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

	/**
	 * Rasterize dcTerrainCost region behaviors into per-level cost maps.
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

	// ── Token occupancy (main thread) ──────────────────────────────

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
	 * @returns {boolean} — synchronous; does not involve the worker.
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

// ── Helper: wall level filter ─────────────────────────────────────

function _wall_affects_level(wall, level) {
	if (!wall.levels || wall.levels.size === 0) return true;
	return wall.levels.has(level.id);
}
