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

const SUCCESS = "success";
const RUNNING = "running";
const FAILURE = "failure";

async function _record_step_movement(bb, move_state, from_xy) {
	if (!is_dc_combat_active()) return false;

	const mode = move_state.movement_mode || bb.movement_mode || "normal";
	const yards = measure_yards_between(bb.scene, from_xy, { x: bb.token.x, y: bb.token.y });
	await record_yards_moved(bb, bb.actor, yards, mode);
	return get_remaining_budget_yards(bb, mode) <= 0;
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
		const px = step.x * grid;
		const py = step.y * grid;
		const from_xy = { x: bb.token.x, y: bb.token.y };

		if (_tile_has_change_level(bb.scene, px, py, grid)) {
			let skip_to = index + 1;
			while (skip_to < path.length) {
				const s = path[skip_to];
				if (!_tile_has_change_level(bb.scene, s.x * grid, s.y * grid, grid)) break;
				skip_to++;
			}
			if (skip_to >= path.length) skip_to = index;

			const dest = path[skip_to];
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
			const from_gx = index > 0 ? path[index - 1].x : Math.floor(bb.token.x / grid);
			const from_gy = index > 0 ? path[index - 1].y : Math.floor(bb.token.y / grid);
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
