/**
 * patrol.js — Action: Patrol
 *
 * Moves to due waypoints on a path. Returns running while moving.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _unix_to_minutes, _find_due_waypoints } from "../../utils.js";

export function register() {
	register_node("action_patrol", {
		category: "action",
		label: "Action: Patrol",
		icon: "fa-solid fa-route",
		description: "Moves to due waypoints on a path. Returns running while moving.",
		tick: async (node, bb, engine) => {
			if (bb.moving) return Status.RUNNING;

			const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
			const path = node.path_name
				? paths.find(p => p.name === node.path_name)
				: paths.find(p => p.enabled);
			if (!path) return Status.FAILURE;

			const old_min = _unix_to_minutes(bb.last_tick_unixtime);
			const new_min = bb.current_minutes;
			const due = _find_due_waypoints(path, old_min, new_min, bb.day_changed);
			if (!due.length) return Status.SUCCESS;

			bb.moving = true;
			bb._currently_moving = true;
			try {
				for (const wp of due) {
					if (wp.scene_id && wp.scene_id !== bb.scene.id) {
						await engine.cross_scene.transition(bb.token, bb.actor, wp);
					} else {
						await engine.animate_to(bb.token, wp);
					}
					await engine.fire_arrival(bb.token, bb.actor, wp);
					bb.current_waypoint = wp.id;
				}
			} finally {
				bb.moving = false;
				bb._currently_moving = false;
			}
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "path_name", type: "text", label: "Path Name (blank = first enabled)", default: "" },
			],
		},
	});
}