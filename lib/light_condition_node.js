/**
 * light_condition_node.js — Registers the condition_light BT node.
 */

import {
	get_light_condition_fields,
	populate_light_condition_fields,
	tick_light_condition,
} from "./light_condition.js";

export function register_light_condition_node(register_node, Status) {
	register_node("condition_light", {
		category: "condition",
		label: "Condition: Light",
		icon: "fa-solid fa-lightbulb",
		description: "Checks scene, campaign, or position darkness, or whether the token is lit.",
		tick: async (node, bb) => tick_light_condition(node, bb),
		editor: {
			get fields() {
				return get_light_condition_fields();
			},
		},
	});
}

export { populate_light_condition_fields };
