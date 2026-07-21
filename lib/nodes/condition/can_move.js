/**
 * can_move.js — Condition: Can Move
 *
 * Checks if this NPC still has Pace movement budget remaining during combat.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { has_movement_budget } from "../../combat_movement.js";

export function register() {
	register_node("condition_can_move", {
		category: "condition",
		label: "Condition: Can Move",
		icon: "fa-solid fa-shoe-prints",
		description: "Checks if this NPC still has Pace movement budget remaining during combat.",
		tick: async (node, bb) => {
			const mode = bb.movement_mode || "normal";
			return has_movement_budget(bb, mode) ? Status.SUCCESS : Status.FAILURE;
		},
	});
}