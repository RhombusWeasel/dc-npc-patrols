/**
 * move_steps.js — Shared multi-tick path stepping for BT movement nodes.
 */

import { _tile_has_change_level, TOKEN_MOVE_OPTS } from "./utils.js";

const SUCCESS = "success";
const RUNNING = "running";
const FAILURE = "failure";

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
		delete bb[move_key];
		return SUCCESS;
	}

	bb.moving = true;
	bb._currently_moving = true;
	try {
		const grid = bb.scene.grid.size;
		const step = path[index];
		const px = step.x * grid;
		const py = step.y * grid;

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
		} else {
			await engine.animate_to(bb.token, step);
			if (step.level_id && step.level_id !== "_default" && step.level_id !== bb.level_id) {
				bb.level_id = step.level_id;
				const lvl = bb.scene.levels.get(step.level_id);
				bb.elevation = lvl?.elevation?.base ?? bb.elevation;
			}
			move_state.index++;
		}
	} finally {
		bb.moving = false;
		bb._currently_moving = false;
	}

	return move_state.index >= path.length ? SUCCESS : RUNNING;
}

/**
 * Run one tick of path movement; returns composite status for BT nodes.
 * @param {object} opts
 * @param {Function|null} opts.on_complete — async callback when path finishes
 */
export async function tick_move_path_node(bb, engine, move_key, opts = {}) {
	if (bb.moving) return RUNNING;
	if (!bb[move_key]) return null;

	const step_status = await tick_move_path(bb, engine, move_key);
	if (step_status === SUCCESS && opts.on_complete) {
		await opts.on_complete(bb[move_key]);
	}
	if (step_status === SUCCESS) {
		delete bb[move_key];
		return SUCCESS;
	}
	return RUNNING;
}
