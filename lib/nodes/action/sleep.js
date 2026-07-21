/**
 * sleep.js — Action: Sleep
 *
 * Pathfinds to a home region, hides token, optionally swaps to a
 * sleeping image. Use with condition_time.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { tick_move_path_node } from "../../move_steps.js";
import { _has_unresolved_variables } from "../../utils.js";
import { find_nearest_region } from "../../region_utils.js";
import { _token_in_region } from "../condition/_shared.js";
import {
	store_original_texture,
	set_token_texture,
} from "../../token_image.js";
import { bt_log } from "../../bt_debug.js";

export function register() {
	register_node("action_sleep", {
		category: "action",
		label: "Action: Sleep",
		icon: "fa-solid fa-bed",
		description: "Pathfinds to a home region, hides token, optionally swaps to a sleeping image. Use with condition_time.",
		tick: async (node, bb, engine) => {
			if (bb.sleep_state === 'asleep') return Status.SUCCESS;

			const region_name = (node.home_region || "").trim();
			if (!region_name) {
				bt_log("sleep.fail", `node=${node._id} actor=${bb.actor?.name} — no home_region set`);
				return Status.FAILURE;
			}
			if (_has_unresolved_variables(region_name)) {
				bt_log("sleep.fail", `node=${node._id} actor=${bb.actor?.name} — unresolved variables in home_region="${region_name}"`);
				return Status.FAILURE;
			}

			// If not yet at the home region, pathfind there first
			if (!_token_in_region(bb, region_name)) {
				const move_key = bb_state_key(bb, `_sleep_${node._id}`);
				const progress = await tick_move_path_node(bb, engine, move_key);
				if (progress === Status.RUNNING) return Status.RUNNING;
				if (progress === Status.SUCCESS) {
					// Arrived — fall through to hide/sleep
				} else {
					// No active path — find the region and start pathfinding
					const region = find_nearest_region(
						bb.scene,
						region_name,
						{ x: bb.token.x, y: bb.token.y },
					);
					if (!region) {
						bt_log("sleep.fail", `node=${node._id} actor=${bb.actor?.name} — region "${region_name}" not found in scene "${bb.scene?.name}"`);
						return Status.FAILURE;
					}

					const path = engine.pathfinding.find_path_to_region_doc(
						bb.scene,
						{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
						region,
						{ exclude_token_id: bb.token.id },
					);
					if (!path?.length) {
						bt_log("sleep.fail", `node=${node._id} actor=${bb.actor?.name} — no path found to region "${region_name}"`);
						return Status.FAILURE;
					}

					bb[move_key] = { path, index: 0, region_name, region_id: region.id };
					return Status.RUNNING;
				}
			}

			// At home — hide token and swap image
			bb.moving = true;
			bb._currently_moving = true;
			try {
				if (node.sleeping_image) {
					store_original_texture(bb, bb.token, bb.actor);
					await set_token_texture(bb.token, node.sleeping_image);
				}
				await bb.token.update({ hidden: true });
			} finally {
				bb.moving = false;
				bb._currently_moving = false;
			}
			bb.sleep_state = 'asleep';
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "home_region", type: "region_select", label: "Home Region", default: "" },
				{ key: "sleeping_image", type: "text", label: "Sleeping Image Path (optional)", default: "" },
			],
		},
	});
}