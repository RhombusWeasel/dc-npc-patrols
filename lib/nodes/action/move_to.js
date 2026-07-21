/**
 * move_to.js — Action: Move To
 *
 * Navigates to a waypoint or coordinate using A* pathfinding around walls.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { _find_waypoint_by_label } from "../../utils.js";
import { tick_move_path_node } from "../../move_steps.js";

export function register() {
	register_node("action_move_to", {
		category: "action",
		label: "Action: Move To",
		icon: "fa-solid fa-location-arrow",
		description: "Navigates to a waypoint or coordinate using A* pathfinding around walls.",
		tick: async (node, bb, engine) => {
			const move_key = bb_state_key(bb, `_move_path_${node._id}`);
			const progress = await tick_move_path_node(bb, engine, move_key);
			if (progress === Status.RUNNING) return Status.RUNNING;
			if (progress === Status.SUCCESS) return Status.SUCCESS;

			const dest = node.waypoint_label
				? _find_waypoint_by_label(bb, node.waypoint_label)
				: { x: node.dest_x, y: node.dest_y, level_id: node.dest_elevation ?? null };
			if (!dest) return Status.FAILURE;

			const grid = bb.scene.grid.size;
			const path = engine.pathfinding.find_path(
				bb.scene,
				{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
				{ x: dest.x * grid, y: dest.y * grid, level_id: dest.level_id ?? bb.level_id },
				{ exclude_token_id: bb.token.id },
			);
			if (!path?.length) return Status.FAILURE;

			bb[move_key] = { path, index: 0 };
			return Status.RUNNING;
		},
		editor: {
			fields: [
				{ key: "waypoint_label", type: "text", label: "Waypoint Label (blank = use coords)", default: "" },
				{ key: "dest_x", type: "number", label: "Dest X (grid)", default: 0 },
				{ key: "dest_y", type: "number", label: "Dest Y (grid)", default: 0 },
				{ key: "dest_elevation", type: "number", label: "Dest Elevation (blank = same level)", default: null },
			],
		},
	});
}