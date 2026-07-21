/**
 * end_turn.js — Action: End Turn
 *
 * Marks this NPC's combat turn complete.
 * The tree keeps ticking until this node runs.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("action_end_turn", {
		category: "action",
		label: "Action: End Turn",
		icon: "fa-solid fa-flag-checkered",
		description: "Marks this NPC's combat turn complete. The tree keeps ticking until this node runs.",
		tick: async (node, bb) => {
			bb.combat_turn_ended = true;
			return Status.SUCCESS;
		},
	});
}