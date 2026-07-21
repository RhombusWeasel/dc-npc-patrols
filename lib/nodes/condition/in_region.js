/**
 * in_region.js — Condition: In Region
 *
 * Checks if the token is currently inside a named region on the scene.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _token_in_region } from "./_shared.js";

export function register() {
	register_node("condition_in_region", {
		category: "condition",
		label: "Condition: In Region",
		icon: "fa-solid fa-vector-square",
		description: "Checks if the token is currently inside a named region on the scene.",
		tick: async (node, bb) => {
			if (!bb.token) return Status.FAILURE;
			return _token_in_region(bb, node.region_name) ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
			],
		},
	});
}