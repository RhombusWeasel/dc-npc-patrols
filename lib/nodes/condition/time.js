/**
 * time.js — Condition: Time
 *
 * Checks if current time is within a window (supports overnight).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _parse_time } from "../../utils.js";

export function register() {
	register_node("condition_time", {
		category: "condition",
		label: "Condition: Time",
		icon: "fa-solid fa-clock",
		description: "Checks if current time is within a window (supports overnight).",
		tick: async (node, bb) => {
			const start = _parse_time(node.start_time || "06:00");
			const end = _parse_time(node.end_time || "22:00");
			const now = bb.current_minutes;
			const in_window = start <= end
				? (now >= start && now <= end)
				: (now >= start || now <= end);
			return in_window ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "start_time", type: "text", label: "Start Time (HH:MM)", default: "06:00" },
				{ key: "end_time",   type: "text", label: "End Time (HH:MM)",   default: "22:00" },
			],
		},
	});
}