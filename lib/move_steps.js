/**
 * move_steps.js — Shared multi-tick path stepping for BT movement nodes.
 */

import { _tile_has_change_level, TOKEN_MOVE_OPTS } from "./utils.js";
import { find_doors_on_tile_step, open_door, close_door } from "./doors.js";
import { is_dc_combat_active } from "./combat_turn.js";
import {
	measure_yards_between,
	record_yards_moved,
	get_remaining_budget_yards,
} from "./combat_movement.js";
import { get_token_center_point } from "./token_actor.js";
import { bt_log } from "./bt_debug.js";

const MODULE_ID = "dc-npc-patrols";
const SUCCESS = "success";
const RUNNING = "running";
const FAILURE = "failure";

/**
 * Create move_state for a new path, capturing the token's starting grid cell.
 * @param {object[]} path
 * @param {object} bb
 * @param {object} [extra]
 */
export function create_move_state(path, bb, extra = {}) {
	const grid = bb.scene.grid.size;
	return {
		path,
		index: 0,
		origin_x: Math.floor(bb.token.x / grid),
		origin_y: Math.floor(bb.token.y / grid),
		origin_level: bb.level_id,
		...extra,
	};
}

function _get_expected_waypoint(move_state, index) {
	if (index > 0) return move_state.path[index - 1];
	if (move_state.origin_x == null || move_state.origin_y == null) return null;
	return {
		x: move_state.origin_x,
		y: move_state.origin_y,
		level_id: move_state.origin_level,
	};
}

function _token_grid_top_left(token_doc, grid) {
	return {
		x: Math.floor(token_doc.x / grid),
		y: Math.floor(token_doc.y / grid),
	};
}

async function _sync_token_to_waypoint(token_doc, scene, waypoint, bb) {
	if (!waypoint) return;

	const grid = scene.grid.size;
	const actual = _token_grid_top_left(token_doc, grid);
	const level_mismatch =
		waypoint.level_id != null &&
		waypoint.level_id !== "_default" &&
		waypoint.level_id !== bb.level_id;

	if (actual.x === waypoint.x && actual.y === waypoint.y && !level_mismatch) return;

	bt_log(
		"move.sync",
		`${bb.actor?.name ?? token_doc?.name} drifted from (${waypoint.x},${waypoint.y}) to (${actual.x},${actual.y}) — displacing`,
	);

	const dest_level = waypoint.level_id ?? bb.level_id;
	const level = dest_level !== "_default" ? scene.levels.get(dest_level) : null;
	const move_data = {
		x: waypoint.x * grid,
		y: waypoint.y * grid,
		action: "displace",
	};
	if (dest_level !== "_default" && dest_level !== bb.level_id) {
		move_data.level = dest_level;
		move_data.elevation = level?.elevation?.base ?? bb.elevation;
	}
	await token_doc.move([move_data], { ...TOKEN_MOVE_OPTS, animate: false });
	if (dest_level !== "_default") {
		bb.level_id = dest_level;
		bb.elevation = level?.elevation?.base ?? bb.elevation;
	}
}

async function _record_step_movement(bb, move_state, from_xy) {
	if (!is_dc_combat_active()) return false;

	const mode = move_state.movement_mode || bb.movement_mode || "normal";
	const yards = measure_yards_between(bb.scene, from_xy, { x: bb.token.x, y: bb.token.y });
	await record_yards_moved(bb, bb.actor, yards, mode);
	return get_remaining_budget_yards(bb, mode) <= 0;
}

/**
 * Abort path when the final step target is occupied by another token.
 * @returns {Promise<boolean>} true if path was aborted
 */
async function _abort_if_final_step_blocked(bb, engine, move_state, move_key, step, step_level) {
	if (!game.settings.get(MODULE_ID, "block_tokens")) return false;

	if (!engine.pathfinding.is_grid_tile_occupied(
		bb.scene, step.x, step.y, step_level, bb.token.id,
	)) {
		return false;
	}

	bt_log(
		"move.blocked",
		`${bb.actor?.name ?? bb.token?.name} tile=(${step.x},${step.y}) — aborting final step, will repath`,
	);
	await _close_tracked_doors(move_state, bb.scene);
	delete bb[move_key];
	return true;
}

/**
 * Advance one step along a stored path on the blackboard.
 * @param {object} bb
 * @param {object} engine
 * @param {string} move_key — blackboard key holding { path, index, ... }
 * @returns {Promise<string>} Status.SUCCESS | Status.RUNNING
 */
export async function tick_move_path(bb, engine, move_key) {
	const move_state = bb[move_key];
	if (!move_state) return FAILURE;

	const { path, index } = move_state;
	if (index >= path.length) {
		await _close_tracked_doors(move_state, bb.scene);
		delete bb[move_key];
		return SUCCESS;
	}

	if (is_dc_combat_active()) {
		const mode = move_state.movement_mode || bb.movement_mode || "normal";
		if (get_remaining_budget_yards(bb, mode) <= 0) {
			return RUNNING;
		}
	}

	bb.moving = true;
	bb._currently_moving = true;
	try {
		const grid = bb.scene.grid.size;
		const step = path[index];
		const expected = _get_expected_waypoint(move_state, index);
		await _sync_token_to_waypoint(bb.token, bb.scene, expected, bb);

		const px = step.x * grid;
		const py = step.y * grid;
		const token_center = get_token_center_point(bb.token, bb.scene);
		const from_xy = { x: token_center.x, y: token_center.y };

		if (_tile_has_change_level(bb.scene, px, py, grid)) {
			let skip_to = index + 1;
			while (skip_to < path.length) {
				const s = path[skip_to];
				if (!_tile_has_change_level(bb.scene, s.x * grid, s.y * grid, grid)) break;
				skip_to++;
			}
			if (skip_to >= path.length) skip_to = index;

			const dest = path[skip_to];
			if (skip_to >= path.length - 1) {
				const dest_level = dest.level_id ?? bb.level_id;
				if (await _abort_if_final_step_blocked(bb, engine, move_state, move_key, dest, dest_level)) {
					return RUNNING;
				}
			}

			const dest_px = dest.x * grid;
			const dest_py = dest.y * grid;
			const dest_level = dest.level_id ?? bb.level_id;
			const level = dest_level !== "_default" ? bb.scene.levels.get(dest_level) : null;

			const move_data = {
				x: dest_px,
				y: dest_py,
				action: "displace",
			};
			if (dest_level !== "_default" && dest_level !== bb.level_id) {
				move_data.level = dest_level;
				move_data.elevation = level?.elevation?.base ?? bb.elevation;
			}
			await bb.token.move([move_data], { ...TOKEN_MOVE_OPTS, animate: false });
			if (dest_level !== "_default") {
				bb.level_id = dest_level;
				bb.elevation = level?.elevation?.base ?? bb.elevation;
			}
			move_state.index = skip_to + 1;
			await _record_step_movement(bb, move_state, from_xy);
		} else {
			if (index >= path.length - 1) {
				const step_level = step.level_id ?? bb.level_id;
				if (await _abort_if_final_step_blocked(bb, engine, move_state, move_key, step, step_level)) {
					return RUNNING;
				}
			}

			const from_gx = index > 0
				? path[index - 1].x
				: (move_state.origin_x ?? Math.floor(bb.token.x / grid));
			const from_gy = index > 0
				? path[index - 1].y
				: (move_state.origin_y ?? Math.floor(bb.token.y / grid));
			const grid_data = engine.pathfinding.get_grid_data(bb.scene);

			if (!move_state.doors_opened) move_state.doors_opened = new Set();
			const crossed = find_doors_on_tile_step(
				from_gx, from_gy, step.x, step.y, grid_data, bb.level_id, bb.scene
			);
			for (const door of crossed) {
				await open_door(door);
				move_state.doors_opened.add(door.id);
			}

			await engine.animate_to(bb.token, step);

			for (const door of crossed) {
				if (move_state.doors_opened.has(door.id)) {
					await close_door(door);
					move_state.doors_opened.delete(door.id);
				}
			}

			if (step.level_id && step.level_id !== "_default" && step.level_id !== bb.level_id) {
				bb.level_id = step.level_id;
				const lvl = bb.scene.levels.get(step.level_id);
				bb.elevation = lvl?.elevation?.base ?? bb.elevation;
			}
			move_state.index++;
			await _record_step_movement(bb, move_state, from_xy);
		}
	} finally {
		bb.moving = false;
		bb._currently_moving = false;
	}

	if (move_state.index >= path.length) {
		await _close_tracked_doors(move_state, bb.scene);
		delete bb[move_key];
		return SUCCESS;
	}

	return RUNNING;
}

async function _close_tracked_doors(move_state, scene) {
	if (!move_state.doors_opened?.size || !scene) return;
	for (const door_id of [...move_state.doors_opened]) {
		const wall = scene.walls.get(door_id);
		if (wall) await close_door(wall);
	}
	move_state.doors_opened.clear();
}

/**
 * Run one tick of path movement; returns composite status for BT nodes.
 * @param {object} opts
 * @param {Function|null} opts.on_complete — async callback when path finishes
 */
export async function tick_move_path_node(bb, engine, move_key, opts = {}) {
	if (bb.moving) return RUNNING;
	const move_state = bb[move_key];
	if (!move_state) return null;

	const step_status = await tick_move_path(bb, engine, move_key);
	if (step_status === SUCCESS && opts.on_complete) {
		await opts.on_complete(move_state);
	}
	if (step_status === SUCCESS) {
		delete bb[move_key];
		return SUCCESS;
	}
	return RUNNING;
}
