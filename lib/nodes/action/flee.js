/**
 * flee.js — Action: Flee
 *
 * Moves to the flee_target waypoint on the active path.
 * During combat, pathfinds with a 3× Pace budget per turn.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { tick_move_path_node } from "../../move_steps.js";
import { is_dc_combat_active } from "../../combat_turn.js";

export function register() {
	register_node("action_flee", {
		category: "action",
		label: "Action: Flee",
		icon: "fa-solid fa-person-running",
		description: "Moves to the flee_target waypoint on the active path. During combat, pathfinds with a 3× Pace budget per turn.",
		tick: async (node, bb, engine) => {
			if (bb.moving) return Status.RUNNING;

			const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
			const path = paths.find(p => p.enabled);
			if (!path) return Status.FAILURE;
			const flee_wp = path.waypoints.find(w => w.flee_target) || path.waypoints[path.waypoints.length - 1];
			if (!flee_wp) return Status.FAILURE;

			if (!is_dc_combat_active()) {
				bb.moving = true;
				bb._currently_moving = true;
				try {
					await engine.animate_to(bb.token, flee_wp);
					await engine.fire_arrival(bb.token, bb.actor, flee_wp);
				} finally {
					bb.moving = false;
					bb._currently_moving = false;
				}
				return Status.SUCCESS;
			}

			const move_key = bb_state_key(bb, `_flee_${node._id}`);
			const progress = await tick_move_path_node(bb, engine, move_key, {
				on_complete: async () => {
					bb.movement_mode = "normal";
					await engine.fire_arrival(bb.token, bb.actor, flee_wp);
				},
			});
			if (progress === Status.RUNNING) return Status.RUNNING;
			if (progress === Status.SUCCESS) return Status.SUCCESS;

			bb.movement_mode = "flee";
			const grid = bb.scene.grid.size;
			const route = engine.pathfinding.find_path(
				bb.scene,
				{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
				{
					x: flee_wp.x * grid,
					y: flee_wp.y * grid,
					level_id: flee_wp.level_id ?? bb.level_id,
				},
				{ exclude_token_id: bb.token.id },
			);
			if (!route?.length) return Status.FAILURE;

			bb[move_key] = {
				path: route,
				index: 0,
				movement_mode: "flee",
				flee_wp,
			};
			return Status.RUNNING;
		},
	});
}