/**
 * wander_region.js — Action: Wander Region
 *
 * Picks a random reachable point inside a named region and pathfinds there.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { _has_unresolved_variables } from "../../utils.js";
import { tick_move_path_node } from "../../move_steps.js";

export function register() {
	register_node("action_wander_region", {
		category: "action",
		label: "Action: Wander Region",
		icon: "fa-solid fa-shuffle",
		description: "Picks a random reachable point inside a named region and pathfinds there.",
		tick: async (node, bb, engine) => {
			const region_name = (node.region_name || "").trim();
			if (!region_name || _has_unresolved_variables(region_name)) {
				return Status.FAILURE;
			}

			const move_key = bb_state_key(bb, `_wander_region_${node._id}`);
			const progress = await tick_move_path_node(bb, engine, move_key);
			if (progress === Status.RUNNING) return Status.RUNNING;
			if (progress === Status.SUCCESS) return Status.SUCCESS;

			const source = { x: bb.token.x, y: bb.token.y, level_id: bb.level_id };
			const dest = engine.pathfinding.pick_random_reachable_cell(
				bb.scene, source, region_name, 8, { exclude_token_id: bb.token.id },
			);
			if (!dest) return Status.FAILURE;

			const grid_data = engine.pathfinding.get_grid_data(bb.scene);
			const cell_size = grid_data.cell_size;
			const path = engine.pathfinding.find_path(
				bb.scene,
				source,
				{
					x: dest.x * cell_size,
					y: dest.y * cell_size,
					level_id: dest.level_id ?? bb.level_id,
				},
				{ exclude_token_id: bb.token.id },
			);
			if (!path?.length) return Status.FAILURE;

			bb[move_key] = { path, index: 0, region_name };
			return Status.RUNNING;
		},
		editor: {
			fields: [
				{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
			],
		},
	});
}