/**
 * range.js — Condition: Range
 *
 * Optional BT distance check against a fixed threshold.
 * Not weapon range — Deadlands handles range penalties on attacks.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	resolve_token_ref,
	measure_token_range,
	get_flag_operator_options,
	get_measure_mode_options,
} from "../../token_target.js";
import { _evaluate_operator } from "../../utils.js";

export function register() {
	register_node("condition_range", {
		category: "condition",
		label: "Condition: Range",
		icon: "fa-solid fa-ruler-horizontal",
		description: "Optional BT distance check against a fixed threshold. Not weapon range — Deadlands handles range penalties on attacks.",
		tick: async (node, bb) => {
			const target_key = (node.target_key || "target").trim() || "target";
			let range = bb[`${target_key}_range`];

			if (range == null) {
				const target_doc = resolve_token_ref(bb, target_key);
				if (!target_doc || !bb.token) return Status.FAILURE;
				range = measure_token_range(bb.token, target_doc, node.measure_mode || "grid_squares");
			}

			return _evaluate_operator(range, node.operator || "less_eq", node.value ?? 0)
				? Status.SUCCESS
				: Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
				{ key: "operator", type: "dropdown", label: "Operator", default: "less_eq",
					options: get_flag_operator_options(),
				},
				{ key: "value", type: "number", label: "Range (grid squares)", default: 6 },
				{ key: "measure_mode", type: "dropdown", label: "Measure Mode (if not pre-measured)", default: "grid_squares",
					options: get_measure_mode_options(),
				},
			],
		},
	});
}