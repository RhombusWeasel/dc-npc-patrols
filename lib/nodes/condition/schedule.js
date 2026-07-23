/**
 * schedule.js — Condition: Schedule
 *
 * Checks world state: time-of-day window, day-of-week, or weather.
 * Replaces the legacy condition_time, condition_day, and condition_weather nodes.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _parse_time } from "../../utils.js";

export function register() {
	register_node("condition_schedule", {
		category: "condition",
		label: "Condition: Schedule",
		icon: "fa-solid fa-clock",
		description: "Checks world state: time-of-day window, day-of-week, or weather.",
		tick: async (node, bb) => {
			const check = node.check || "time_window";

			if (check === "time_window") {
				const start = _parse_time(node.start_time || "06:00");
				const end = _parse_time(node.end_time || "22:00");
				const now = bb.current_minutes;
				const in_window = start <= end
					? (now >= start && now <= end)
					: (now >= start || now <= end);
				return in_window ? Status.SUCCESS : Status.FAILURE;
			}

			if (check === "day_of_week") {
				const days = node.days || [];
				if (!days.length) return Status.SUCCESS;
				return days.includes(bb.weekday) ? Status.SUCCESS : Status.FAILURE;
			}

			if (check === "weather") {
				const weather = bb.weather;
				const matches = weather === node.weather;
				return (node.match === false ? !matches : matches)
					? Status.SUCCESS : Status.FAILURE;
			}

			return Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "check", type: "dropdown", label: "Check", default: "time_window",
					options: [
						{ value: "time_window", label: "Time of Day" },
						{ value: "day_of_week", label: "Day of Week" },
						{ value: "weather", label: "Weather" },
					],
				},
				{ key: "start_time", type: "text", label: "Start Time (HH:MM)", default: "06:00",
					condition: { field: "check", value: "time_window" },
				},
				{ key: "end_time", type: "text", label: "End Time (HH:MM)", default: "22:00",
					condition: { field: "check", value: "time_window" },
				},
				{ key: "days", type: "text", label: "Days (0=Sun..6=Sat, comma-sep)", default: "0,1,2,3,4,5,6",
					condition: { field: "check", value: "day_of_week" },
				},
				{ key: "weather", type: "dropdown", label: "Weather", default: "rain",
					options: [
						{ value: "clear", label: "Clear" },
						{ value: "rain", label: "Rain" },
						{ value: "snow", label: "Snow" },
						{ value: "storm", label: "Storm" },
						{ value: "fog", label: "Fog" },
					],
					condition: { field: "check", value: "weather" },
				},
				{ key: "match", type: "dropdown", label: "Match Mode", default: true,
					options: [
						{ value: true, label: "Matches" },
						{ value: false, label: "Does Not Match" },
					],
					condition: { field: "check", value: "weather" },
				},
			],
		},
	});
}