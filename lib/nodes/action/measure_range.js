/**
 * measure_range.js — Action: Measure Range
 *
 * Measures distance from this token to a blackboard target and
 * stores it as {target_key}_range.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	resolve_token_ref,
	measure_token_range,
	get_measure_mode_options,
} from "../../token_target.js";

export function register() {
	register_node("action_measure_range", {
		category: "action",
		label: "Action: Measure Range",
		icon: "fa-solid fa-ruler",
		description: "Measures distance from this token to a blackboard target and stores it as {target_key}_range.",
		tick: async (node, bb) => {
			const target_key = (node.target_key || "target").trim() || "target";
			const target_doc = resolve_token_ref(bb, target_key);
			if (!target_doc || !bb.token) return Status.FAILURE;

			const mode = node.measure_mode || "grid_squares";
			bb[`${target_key}_range`] = measure_token_range(bb.token, target_doc, mode);
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
				{ key: "measure_mode", type: "dropdown", label: "Measure Mode", default: "grid_squares",
					options: get_measure_mode_options(),
				},
			],
		},
	});
}