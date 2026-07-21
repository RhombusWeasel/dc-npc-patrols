/**
 * move_to.js — Action: Move To
 *
 * Navigates to a grid coordinate using A* pathfinding around walls.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { _resolve_value } from "../../utils.js";
import { tick_move_path_node } from "../../move_steps.js";
import { bt_log } from "../../bt_debug.js";

export function register() {
	register_node("action_move_to", {
		category: "action",
		label: "Action: Move To",
		icon: "fa-solid fa-location-arrow",
		description: "Navigates to a grid coordinate using A* pathfinding around walls.",
		tick: async (node, bb, engine) => {
			const move_key = bb_state_key(bb, `_move_path_${node._id}`);
			const progress = await tick_move_path_node(bb, engine, move_key);
			if (progress === Status.RUNNING) return Status.RUNNING;
			if (progress === Status.SUCCESS) return Status.SUCCESS;

			const dest_x = _resolve_value(node.dest_x, bb);
			const dest_y = _resolve_value(node.dest_y, bb);
			if (dest_x == null || dest_y == null) {
				bt_log("move_to.fail", `node=${node._id} actor=${bb.actor?.name} — no destination coordinates`);
				return Status.FAILURE;
			}

			const grid = bb.scene.grid.size;
			const path = engine.pathfinding.find_path(
				bb.scene,
				{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
				{ x: dest_x * grid, y: dest_y * grid, level_id: node.dest_level_id ?? bb.level_id },
				{ exclude_token_id: bb.token.id },
			);
			if (!path?.length) {
				bt_log("move_to.fail", `node=${node._id} actor=${bb.actor?.name} — no path to (${dest_x}, ${dest_y})`);
				return Status.FAILURE;
			}

			bb[move_key] = { path, index: 0 };
			return Status.RUNNING;
		},
		editor: {
			fields: [
				{ key: "dest_x", type: "number", label: "Dest X (grid)", default: 0 },
				{ key: "dest_y", type: "number", label: "Dest Y (grid)", default: 0 },
				{ key: "dest_level_id", type: "text", label: "Dest Level ID (blank = same level)", default: "" },
			],
		},
	});
}