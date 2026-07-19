/**
 * combat_movement.js — Pace-based movement budgets during Deadlands combat.
 */

import { is_dc_combat_active } from "./combat_turn.js";

export function yards_per_grid(scene) {
	return scene?.grid?.distance ?? canvas?.grid?.distance ?? 1.666667;
}

export function grid_units_to_yards(units, scene) {
	return units * yards_per_grid(scene);
}

export function measure_yards_between(scene, from_xy, to_xy) {
	if (!from_xy || !to_xy || !scene) return 0;

	if (canvas?.grid?.measurePath) {
		const result = canvas.grid.measurePath([from_xy, to_xy]);
		return grid_units_to_yards(result.distance, scene);
	}

	const grid = scene.grid?.size ?? canvas?.grid?.size ?? 100;
	const dist_px = Math.hypot(to_xy.x - from_xy.x, to_xy.y - from_xy.y);
	return grid_units_to_yards(dist_px / grid, scene);
}

export function get_actor_pace(actor) {
	return Number(actor?.system?.char?.pace) || 6;
}

export function get_round_budget_yards(actor) {
	return get_actor_pace(actor) * 2;
}

export function get_flee_turn_budget_yards(actor) {
	return get_actor_pace(actor) * 3;
}

export function get_remaining_budget_yards(bb, mode = "normal") {
	if (!bb?.actor) return Infinity;

	const pace = get_actor_pace(bb.actor);
	if (mode === "flee") {
		return Math.max(0, (pace * 3) - (bb.yards_moved_this_action ?? 0));
	}
	return Math.max(0, (pace * 2) - (bb.yards_moved_this_round ?? 0));
}

export function can_spend_yards(bb, yards, mode = "normal") {
	if (!is_dc_combat_active()) return true;
	return yards <= get_remaining_budget_yards(bb, mode);
}

export async function clear_actor_running(actor) {
	if (!actor?.system?.char || !game.dc?.utils?.save_actor) return;
	if (!actor.system.char.is_running) return;
	await game.dc.utils.save_actor(actor, (system) => {
		system.char.is_running = false;
	}, { render: false });
}

async function set_actor_running(actor) {
	if (!actor?.system?.char || !game.dc?.utils?.save_actor) return;
	if (actor.system.char.is_running) return;
	await game.dc.utils.save_actor(actor, (system) => {
		system.char.is_running = true;
	}, { render: false });
}

export async function record_yards_moved(bb, actor, yards, mode = "normal") {
	if (!is_dc_combat_active() || yards <= 0 || !bb) return;

	bb.yards_moved_this_round = (bb.yards_moved_this_round ?? 0) + yards;
	bb.yards_moved_this_action = (bb.yards_moved_this_action ?? 0) + yards;

	if (mode !== "flee" && bb.yards_moved_this_action > get_actor_pace(actor)) {
		await set_actor_running(actor);
	}
}

export async function reset_action_movement(bb, actor) {
	if (!bb) return;
	bb.yards_moved_this_action = 0;
	await clear_actor_running(actor);
}

export function reset_round_movement(bb) {
	if (!bb) return;
	bb.yards_moved_this_round = 0;
}

export function has_movement_budget(bb, mode = "normal") {
	if (!is_dc_combat_active()) return true;
	return get_remaining_budget_yards(bb, mode) > 0;
}
