/**
 * sleep.js — Action: Sleep
 *
 * Hides token, teleports to home waypoint. Use with condition_time.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	store_original_texture,
	set_token_texture,
} from "../../token_image.js";

export function register() {
	register_node("action_sleep", {
		category: "action",
		label: "Action: Sleep",
		icon: "fa-solid fa-bed",
		description: "Hides token, teleports to home waypoint. Use with condition_time.",
		tick: async (node, bb, engine) => {
			if (bb.sleep_state === 'asleep') return Status.SUCCESS;

			const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
			const path = paths.find(p => p.enabled);
			if (!path) return Status.FAILURE;
			const home_wp = path.waypoints.find(w => w.id === node.home_waypoint)
				|| path.waypoints.find(w => w.home);
			if (!home_wp) return Status.FAILURE;

			bb.moving = true;
			bb._currently_moving = true;
			try {
				await engine.animate_to(bb.token, home_wp);
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
				{ key: "home_waypoint", type: "text", label: "Home Waypoint ID (blank = first 'home' waypoint)", default: "" },
				{ key: "sleeping_image", type: "text", label: "Sleeping Image Path (optional)", default: "" },
			],
		},
	});
}