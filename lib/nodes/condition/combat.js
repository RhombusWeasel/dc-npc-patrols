/**
 * combat.js — Condition: Combat
 *
 * Checks if a combat encounter is active.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("condition_combat", {
		category: "condition",
		label: "Condition: Combat",
		icon: "fa-solid fa-swords",
		description: "Checks if a combat encounter is active.",
		tick: async (node, bb) => {
			return bb.combat_active ? Status.SUCCESS : Status.FAILURE;
		},
	});
}