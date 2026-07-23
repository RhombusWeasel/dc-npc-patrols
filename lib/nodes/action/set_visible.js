/**
 * set_visible.js — Action: Set Visible
 *
 * Shows or hides the token, with an optional image swap when hiding
 * (e.g. a sleeping portrait) and automatic restore when showing.
 *
 * Replaces the legacy action_sleep and action_wake nodes.
 * To replicate sleep: sequence(move_to_region, set_visible hidden)
 * To replicate wake: set_visible shown
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	store_original_texture,
	set_token_texture,
	restore_token_texture,
} from "../../token_image.js";

export function register() {
	register_node("action_set_visible", {
		category: "action",
		label: "Action: Set Visible",
		icon: "fa-solid fa-eye",
		description: "Shows or hides the token. When hiding, optionally swaps to an alternate image (e.g. sleeping). When showing, restores the original image if one was stored.",
		tick: async (node, bb) => {
			const visible = node.visible ?? true;

			if (visible) {
				// Show token + restore image
				await bb.token.update({ hidden: false });
				if (bb._original_image) {
					await restore_token_texture(bb, bb.token, bb.actor);
				}
			} else {
				// Hide token, optionally swap image
				if (node.alternate_image) {
					store_original_texture(bb, bb.token, bb.actor);
					await set_token_texture(bb.token, node.alternate_image);
				}
				await bb.token.update({ hidden: true });
			}

			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "visible", type: "boolean", label: "Visible", default: true },
				{ key: "alternate_image", type: "text", label: "Alternate Image Path (when hidden)", default: "" },
			],
		},
	});
}