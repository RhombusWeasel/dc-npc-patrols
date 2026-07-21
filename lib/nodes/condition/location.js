/**
 * location.js — Condition: At Location
 *
 * Checks if token is at a named waypoint or within N grid squares.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _find_waypoint_by_label } from "../../utils.js";

export function register() {
	register_node("condition_location", {
		category: "condition",
		label: "Condition: At Location",
		icon: "fa-solid fa-location-dot",
		description: "Checks if token is at a named waypoint or within N grid squares.",
		tick: async (node, bb) => {
			if (!bb.token) return Status.FAILURE;
			const grid = bb.scene.grid.size;
			const wp = _find_waypoint_by_label(bb, node.waypoint_label);
			if (!wp) return Status.FAILURE;
			const dx = Math.abs(bb.token.x / grid - wp.x);
			const dy = Math.abs(bb.token.y / grid - wp.y);
			const dist = Math.sqrt(dx * dx + dy * dy);
			return dist <= (node.radius ?? 1) ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "waypoint_label", type: "text", label: "Waypoint Label", default: "" },
				{ key: "radius", type: "number", label: "Radius (grid squares)", default: 1 },
			],
		},
	});
}