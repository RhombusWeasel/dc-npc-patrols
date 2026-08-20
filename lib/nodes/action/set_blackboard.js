/**
 * set_blackboard.js — Action: Set Blackboard
 *
 * Writes an arbitrary key/value onto the NPC's blackboard. Lets trees
 * remember state across ticks (e.g. last_seen_player, alert counters,
 * has_been_approached) without persisting to actor flags.
 *
 * Values are stored as strings by default; use the `value_type` field to
 * coerce to number or boolean. Supports {{var}} placeholders in the value.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _resolve_value } from "../../utils.js";

export function register() {
	register_node("action_set_blackboard", {
		category: "action",
		label: "Action: Set Blackboard",
		icon: "fa-solid fa-memory",
		description: "Writes a key/value onto the NPC's blackboard so the tree can remember state across ticks. Read it back with Condition: Blackboard.",
		tick: async (node, bb) => {
			const key = (node.key || "").trim();
			if (!key) return Status.FAILURE;

			let value = _resolve_value(node.value, bb.variables || {});
			const value_type = node.value_type || "text";

			if (value_type === "number") {
				value = Number(value);
				if (Number.isNaN(value)) value = 0;
			} else if (value_type === "boolean") {
				value = value === true
					|| String(value).toLowerCase() === "true"
					|| value === 1
					|| value === "1";
			} else {
				value = String(value ?? "");
			}

			bb[key] = value;
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "key", type: "text", label: "Blackboard Key", default: "" },
				{ key: "value", type: "text", label: "Value", default: "" },
				{ key: "value_type", type: "dropdown", label: "Value Type", default: "text",
					options: { text: "Text", number: "Number", boolean: "Boolean" },
				},
			],
		},
	});
}
