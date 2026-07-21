/**
 * weather.js — Condition: Weather
 *
 * Checks the scene's weather flag.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("condition_weather", {
		category: "condition",
		label: "Condition: Weather",
		icon: "fa-solid fa-cloud-rain",
		description: "Checks the scene's weather flag.",
		tick: async (node, bb) => {
			const weather = bb.weather;
			const matches = weather === node.weather;
			return (node.match === false ? !matches : matches)
				? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "weather", type: "dropdown", label: "Weather", default: "rain",
					options: {
						clear: "Clear", rain: "Rain", snow: "Snow",
						storm: "Storm", fog: "Fog",
					},
				},
				{ key: "match", type: "dropdown", label: "Match Mode", default: true,
					options: { true: "Matches", false: "Does Not Match" },
				},
			],
		},
	});
}