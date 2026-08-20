/**
 * blackboard.js — Condition: Blackboard
 *
 * Checks a value written to the NPC's blackboard (by action_set_blackboard,
 * acquire_target, update_visible_tokens, or the engine) against an operator.
 *
 * Mirrors condition_variable but reads from the runtime blackboard instead
 * of tree template variables. Supports the same 9 flag operators.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _evaluate_operator } from "../../utils.js";
import { get_flag_operator_options } from "../../token_target.js";
import { coerce_condition_expected } from "../../bt_var_field_ui.js";

export function register() {
	register_node("condition_blackboard", {
		category: "condition",
		label: "Condition: Blackboard",
		icon: "fa-solid fa-brain",
		description: "Checks a value on the NPC's blackboard (written by Set Blackboard, Acquire Target, or the engine) against an operator.",
		tick: async (node, bb) => {
			const key = (node.key || "").trim();
			if (!key) return Status.FAILURE;

			const actual = bb[key];
			const expected = coerce_condition_expected(actual, node.expected_value);

			const result = _evaluate_operator(actual, node.operator || "exists", expected);
			return result ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "key", type: "text", label: "Blackboard Key", default: "" },
				{ key: "operator", type: "dropdown", label: "Operator", default: "exists",
					options: get_flag_operator_options(),
				},
				{ key: "expected_value", type: "text", label: "Expected Value", default: "" },
			],
		},
		// key is a literal blackboard key name — must not be template-resolved
		no_resolve: ["key"],
	});
}
