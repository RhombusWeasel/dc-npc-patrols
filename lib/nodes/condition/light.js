/**
 * light.js — Condition: Light
 *
 * Checks scene, campaign, or position darkness, or whether the token is lit.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	get_light_condition_fields,
	tick_light_condition,
} from "../../light_condition.js";

export function register() {
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