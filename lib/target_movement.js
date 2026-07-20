/**
 * target_movement.js — Path movement toward a blackboard target at a set range.
 */

import { measure_token_range, resolve_token_ref } from "./token_target.js";
import { tick_move_path_node } from "./move_steps.js";
import { warn_combat_once } from "./bt_combat_log.js";

const SUCCESS = "success";
const RUNNING = "running";
const FAILURE = "failure";

export function get_token_center_px(token_doc) {
	return token_doc.getCenterPoint?.() ?? { x: token_doc.x, y: token_doc.y };
}

export function compute_close_goal_px(observer_doc, target_doc, range_squares, mode, scene) {
	const grid = scene.grid.size;
	const observer = get_token_center_px(observer_doc);
	const target = get_token_center_px(target_doc);
	const level_id = target_doc.level
		?? target_doc._source?.level
		?? observer_doc.level
		?? observer_doc._source?.level
		?? scene.levels.contents[0]?.id
		?? "_default";

	let dx = observer.x - target.x;
	let dy = observer.y - target.y;
	const len = Math.hypot(dx, dy);

	if (len <= 0) {
		return { x: target.x, y: target.y, level_id };
	}

	const standoff = (mode === "maintain"
		? Math.max(range_squares, 0)
		: Math.max(range_squares, 1)) * grid;
	return {
		x: target.x + (dx / len) * standoff,
		y: target.y + (dy / len) * standoff,
		level_id,
	};
}

export function should_repath_to_target(move_state, target_doc, grid_size) {
	if (!move_state || move_state.target_x == null || move_state.target_y == null) {
		return true;
	}
	const target = get_token_center_px(target_doc);
	const dx = target.x - move_state.target_x;
	const dy = target.y - move_state.target_y;
	if (Math.hypot(dx, dy) > grid_size) return true;

	// Repath if the target has changed level since the current path was computed
	const target_level = target_doc.level ?? target_doc._source?.level ?? null;
	if (move_state.target_level != null && target_level != null && move_state.target_level !== target_level) {
		return true;
	}

	return false;
}

function _within_range(observer_doc, target_doc, range, measure_mode) {
	const dist = measure_token_range(observer_doc, target_doc, measure_mode);
	return dist != null && dist <= range;
}

/**
 * One tick of close-on-target movement for BT action_close_on_target.
 * @returns {Promise<string>} success | running | failure
 */
export async function tick_close_on_target(bb, engine, node, move_key) {
	const target_key = (node.target_key || "target").trim() || "target";
	const target_doc = resolve_token_ref(bb, target_key);
	if (!target_doc || !bb.token) return FAILURE;

	const range = Number(node.range ?? 1);
	const mode = node.mode || "approach";
	const measure_mode = node.measure_mode || "combat_grid";
	const grid = bb.scene.grid.size;

	if (_within_range(bb.token, target_doc, range, measure_mode)) {
		delete bb[move_key];
		return SUCCESS;
	}

	if (bb[move_key] && !should_repath_to_target(bb[move_key], target_doc, grid)) {
		const progress = await tick_move_path_node(bb, engine, move_key);
		if (_within_range(bb.token, target_doc, range, measure_mode)) {
			delete bb[move_key];
			return SUCCESS;
		}
		if (progress === SUCCESS) {
			delete bb[move_key];
			return RUNNING;
		}
		if (progress === RUNNING) return RUNNING;
	}

	delete bb[move_key];

	const source = { x: bb.token.x, y: bb.token.y, level_id: bb.level_id };
	const goal = compute_close_goal_px(bb.token, target_doc, range, mode, bb.scene);
	const path = engine.pathfinding.find_path(bb.scene, source, goal, { exclude_token_id: bb.token.id });
	if (!path?.length) {
		warn_combat_once(bb, "close_no_path", "could not path toward target (blocked or unreachable)");
		return FAILURE;
	}

	const target_center = get_token_center_px(target_doc);
	const target_level = target_doc.level ?? target_doc._source?.level ?? null;
	bb[move_key] = {
		path,
		index: 0,
		target_x: target_center.x,
		target_y: target_center.y,
		target_level,
		mode,
		range,
	};
	return RUNNING;
}
