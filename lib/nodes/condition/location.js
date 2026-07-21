/**
 * location.js — Condition: At Location
 *
 * Checks if token is at a grid coordinate within N grid squares.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _resolve_value } from "../../utils.js";

export function register() {
	register_node("condition_location", {
		category: "condition",
		label: "Condition: At Location",
		icon: "fa-solid fa-location-dot",
		description: "Checks if token is at a grid coordinate within N grid squares.",
		tick: async (node, bb) => {
			if (!bb.token) return Status.FAILURE;
			const grid = bb.scene.grid.size;
			const dest_x = _resolve_value(node.dest_x, bb);
			const dest_y = _resolve_value(node.dest_y, bb);
			if (dest_x == null || dest_y == null) return Status.FAILURE;
			const dx = Math.abs(bb.token.x / grid - dest_x);
			const dy = Math.abs(bb.token.y / grid - dest_y);
			const dist = Math.sqrt(dx * dx + dy * dy);
			return dist <= (node.radius ?? 1) ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "dest_x", type: "number", label: "Dest X (grid)", default: 0 },
				{ key: "dest_y", type: "number", label: "Dest Y (grid)", default: 0 },
				{ key: "radius", type: "number", label: "Radius (grid squares)", default: 1 },
			],
		},
	});
}