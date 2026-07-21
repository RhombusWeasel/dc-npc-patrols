/**
 * day.js — Condition: Day
 *
 * Checks if today is one of the specified weekdays.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("condition_day", {
		category: "condition",
		label: "Condition: Day",
		icon: "fa-solid fa-calendar",
		description: "Checks if today is one of the specified weekdays.",
		tick: async (node, bb) => {
			const days = node.days || [];
			if (!days.length) return Status.SUCCESS;
			return days.includes(bb.weekday) ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "days", type: "text", label: "Days (0=Sun..6=Sat, comma-sep)", default: "0,1,2,3,4,5,6" },
			],
		},
	});
}