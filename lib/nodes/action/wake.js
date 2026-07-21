/**
 * wake.js — Action: Wake
 *
 * Shows token and restores image. Use after action_sleep.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { restore_token_texture } from "../../token_image.js";

export function register() {
	register_node("action_wake", {
		category: "action",
		label: "Action: Wake",
		icon: "fa-solid fa-sun",
		description: "Shows token and restores image. Use after action_sleep.",
		tick: async (node, bb) => {
			if (bb.sleep_state === 'awake') return Status.SUCCESS;
			await bb.token.update({ hidden: false });
			if (bb._original_image) {
				await restore_token_texture(bb, bb.token, bb.actor);
			}
			bb.sleep_state = 'awake';
			return Status.SUCCESS;
		},
	});
}