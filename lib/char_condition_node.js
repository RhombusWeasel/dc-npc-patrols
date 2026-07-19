/**
 * char_condition_node.js — Registers the condition_character BT node.
 */

import {
	get_character_condition_fields,
	populate_character_condition_fields,
	tick_character_condition,
} from "./char_condition.js";

export function register_character_condition_node(register_node, Status) {
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

export { populate_character_condition_fields };
