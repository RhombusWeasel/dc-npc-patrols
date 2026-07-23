/**
 * move_to_region.js — Action: Move To Region
 *
 * Navigates to the nearest cell inside a named region using A* pathfinding.
 * Fires arrival events on reaching the region.
 * Supports a 'flee' movement mode that uses a 3× Pace budget per turn in combat.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { _has_unresolved_variables } from "../../utils.js";
import { tick_move_path_node } from "../../move_steps.js";
import { find_nearest_region } from "../../region_utils.js";
import { _token_in_region } from "../condition/_shared.js";
import { bt_log } from "../../bt_debug.js";

export function register() {
	register_node("action_move_to_region", {
		category: "action",
		label: "Action: Move To Region",
		icon: "fa-solid fa-vector-square",
		description: "Navigates to the nearest cell inside a named region using A* pathfinding. Supports flee mode (3× Pace budget in combat). Fires arrival events on reaching the region.",
		tick: async (node, bb, engine) => {
			const region_name = (node.region_name || "").trim();
			if (!region_name) {
				bt_log("move_to_region.fail", `node=${node._id} actor=${bb.actor?.name} — no region_name set`);
				return Status.FAILURE;
			}
			if (_has_unresolved_variables(region_name)) {
				bt_log("move_to_region.fail", `node=${node._id} actor=${bb.actor?.name} — unresolved variables in region_name="${region_name}"`);
				return Status.FAILURE;
			}

			if (_token_in_region(bb, region_name)) {
				delete bb[bb_state_key(bb, `_move_region_${node._id}`)];
				return Status.SUCCESS;
			}

			const move_key = bb_state_key(bb, `_move_region_${node._id}`);
			const progress = await tick_move_path_node(bb, engine, move_key, {
				on_complete: async (state) => {
					const last_step = state.path[state.path.length - 1];
					await engine.fire_arrival(bb.token, bb.actor, {
						region_name: state.region_name,
						x: last_step.x * bb.scene.grid.size,
						y: last_step.y * bb.scene.grid.size,
					});
				},
			});
			if (progress === Status.RUNNING) return Status.RUNNING;
			if (progress === Status.SUCCESS) return Status.SUCCESS;

			const region = find_nearest_region(
				bb.scene,
				region_name,
				{ x: bb.token.x, y: bb.token.y },
			);
			if (!region) {
				const all_names = bb.scene?.regions?.map((r) => r.name) ?? [];
				bt_log("move_to_region.fail", `node=${node._id} actor=${bb.actor?.name} — region "${region_name}" not found in scene "${bb.scene?.name}" (${bb.scene?.regions?.size ?? 0} regions: [${all_names.map((n) => `"${n}"`).join(", ")}])`);
				return Status.FAILURE;
			}

			const movement_mode = node.movement_mode || "normal";
			if (movement_mode === "flee") {
				bb.movement_mode = "flee";
			} else {
				delete bb.movement_mode;
			}

			const path = engine.pathfinding.find_path_to_region_doc(
				bb.scene,
				{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
				region,
				{ exclude_token_id: bb.token.id },
			);
			if (!path?.length) {
				bt_log("move_to_region.fail", `node=${node._id} actor=${bb.actor?.name} — no path found to region "${region_name}" (region.id=${region.id})`);
				return Status.FAILURE;
			}

			bb[move_key] = {
				path,
				index: 0,
				movement_mode,
				region_name,
				region_id: region.id,
			};
			return Status.RUNNING;
		},
		editor: {
			fields: [
				{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
				{ key: "movement_mode", type: "dropdown", label: "Movement Mode", default: "normal",
					options: [
						{ value: "normal", label: "Normal" },
						{ value: "flee", label: "Flee (3× Pace in combat)" },
					],
				},
			],
		},
	});
}