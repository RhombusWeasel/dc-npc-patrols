/**
 * my_turn.js — Condition: My Turn
 *
 * Checks if this NPC is currently taking their combat turn.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("condition_my_turn", {
		category: "condition",
		label: "Condition: My Turn",
		icon: "fa-solid fa-hourglass-start",
		description: "Checks if this NPC is currently taking their combat turn.",
		tick: async (node, bb) => {
			return bb.is_my_turn ? Status.SUCCESS : Status.FAILURE;
		},
	});
}