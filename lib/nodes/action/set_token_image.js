/**
 * set_token_image.js — Action: Set Token Image
 *
 * Sets, restores, or resets the token image. Supports {{var}} in image path.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _fill_placeholders } from "../../utils.js";
import {
	store_original_texture,
	set_token_texture,
	restore_token_texture,
	get_token_image_mode_options,
} from "../../token_image.js";

export function register() {
	register_node("action_set_token_image", {
		category: "action",
		label: "Action: Set Token Image",
		icon: "fa-solid fa-image",
		description: "Sets, restores, or resets the token image. Supports {{var}} in image path.",
		tick: async (node, bb) => {
			if (!bb.token) return Status.FAILURE;

			const mode = node.mode || "set";

			if (mode === "restore") {
				const ok = await restore_token_texture(bb, bb.token, bb.actor);
				return ok ? Status.SUCCESS : Status.FAILURE;
			}

			if (mode === "prototype") {
				const src = bb.actor?.prototypeToken?.texture?.src;
				if (!src) return Status.FAILURE;
				if (node.store_original !== false) {
					store_original_texture(bb, bb.token, bb.actor);
				}
				await set_token_texture(bb.token, src);
				return Status.SUCCESS;
			}

			const image_path = _fill_placeholders(node.image_path || "", bb).trim();
			if (!image_path) return Status.FAILURE;

			if (node.store_original !== false) {
				store_original_texture(bb, bb.token, bb.actor);
			}
			const ok = await set_token_texture(bb.token, image_path);
			return ok ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "mode", type: "dropdown", label: "Mode", default: "set",
					options: get_token_image_mode_options(),
				},
				{ key: "image_path", type: "text", label: "Image Path (set mode)", default: "" },
				{ key: "store_original", type: "boolean", label: "Store Original Before Change", default: true },
			],
		},
	});
}