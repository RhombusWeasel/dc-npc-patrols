/**
 * door_interact.js — Action: Door Interact
 *
 * Paths to a door wall and sets its state (open, closed, or locked).
 * Works on regular, secret, and locked doors.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { _has_unresolved_variables } from "../../utils.js";
import { tick_move_path_node } from "../../move_steps.js";
import { resolve_wall, set_door_state, door_state_from_key, is_token_adjacent_to_door } from "../../doors.js";

export function register() {
	register_node("action_door_interact", {
		category: "action",
		label: "Action: Door Interact",
		icon: "fa-solid fa-door-open",
		description: "Paths to a door wall and sets its state (open, closed, or locked). Works on regular, secret, and locked doors.",
		tick: async (node, bb, engine) => {
			const move_key = bb_state_key(bb, `_door_interact_${node._id}`);
			const wall_id = (node.wall_id || "").trim();
			const target_state = node.target_state || "open";

			if (!wall_id || _has_unresolved_variables(wall_id)) return Status.FAILURE;

			const progress = await tick_move_path_node(bb, engine, move_key, {
				on_complete: async (state) => {
					const wall = await resolve_wall(bb.scene, state.wall_id);
					if (!wall) return;
					const ds = door_state_from_key(state.target_state);
					if (wall.ds !== ds) await set_door_state(wall, ds);
				},
			});
			if (progress === Status.RUNNING) return Status.RUNNING;
			if (progress === Status.SUCCESS) return Status.SUCCESS;

			const wall = await resolve_wall(bb.scene, wall_id);
			if (!wall) return Status.FAILURE;

			const ds = door_state_from_key(target_state);
			if (wall.ds === ds) return Status.SUCCESS;

			const grid_data = engine.pathfinding.get_grid_data(bb.scene);
			if (is_token_adjacent_to_door(bb.token, wall, bb.scene, bb.level_id, grid_data)) {
				await set_door_state(wall, ds);
				return Status.SUCCESS;
			}

			const path = engine.pathfinding.find_path_to_wall(
				bb.scene,
				{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
				wall,
				{ exclude_token_id: bb.token.id },
			);
			if (!path?.length) return Status.FAILURE;

			bb[move_key] = { path, index: 0, wall_id, target_state };
			return Status.RUNNING;
		},
		editor: {
			fields: [
				{ key: "wall_id", type: "foundry_id", label: "Door Wall ID", default: "" },
				{
					key: "target_state",
					type: "dropdown",
					label: "Target State",
					default: "open",
					options: { open: "Open", closed: "Closed", locked: "Locked" },
				},
			],
		},
	});
}