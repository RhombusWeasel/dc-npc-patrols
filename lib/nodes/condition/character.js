/**
 * character.js — Condition: Character
 *
 * Checks character pools, traits, skills, gear, flags, edges, equipment,
 * statuses, or scalar stats.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	get_character_condition_fields,
	tick_character_condition,
} from "../../char_condition.js";

export function register() {
	register_node("condition_character", {
		category: "condition",
		label: "Condition: Character",
		icon: "fa-solid fa-user-check",
		description: "Checks character pools, traits, skills, gear, flags, edges, equipment, statuses, or scalar stats.",
		tick: async (node, bb) => tick_character_condition(node, bb),
		editor: {
			get fields() {
				return get_character_condition_fields();
			},
		},
	});
}