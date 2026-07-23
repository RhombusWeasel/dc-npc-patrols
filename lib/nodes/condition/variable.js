/**
 * variable.js — Condition: Variable
 *
 * Checks a behaviour-tree template variable resolved for this NPC.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _evaluate_operator } from "../../utils.js";
import { get_flag_operator_options } from "../../token_target.js";

export function register() {
	register_node("condition_variable", {
		category: "condition",
		label: "Condition: Variable",
		icon: "fa-solid fa-sliders",
		description: "Checks a behaviour-tree template variable resolved for this NPC (e.g. is_believer).",
		tick: async (node, bb) => {
			// Accept both "var_name" and "{{var_name}}" — the mustache syntax
			// is used throughout the BT editor so users naturally write it here.
			const variable_key = String(node.variable_key || "")
				.trim()
				.replace(/^\{\{(.+)\}\}$/, "$1")
				.trim();
			if (!variable_key) return Status.FAILURE;

			const actual = bb.variables?.[variable_key];
			let expected = node.expected_value;
			if (typeof actual === "boolean") {
				expected = expected === true || String(expected).toLowerCase() === "true" || expected === 1 || expected === "1";
			}

			const result = _evaluate_operator(actual, node.operator || "equals", expected);
			return result ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "variable_key", type: "text", label: "Variable Key", default: "" },
				{ key: "operator", type: "dropdown", label: "Operator", default: "equals",
					options: get_flag_operator_options(),
				},
				{ key: "expected_value", type: "text", label: "Expected Value", default: "" },
			],
		},
		// variable_key is a literal key name — must not be template-resolved
		no_resolve: ["variable_key"],
	});
}