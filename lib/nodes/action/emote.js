/**
 * emote.js — Action: Emote
 *
 * Sends a random emote chat line and optionally rotates token.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("action_emote", {
		category: "action",
		label: "Action: Emote",
		icon: "fa-solid fa-face-smile",
		description: "Sends a random emote chat line and optionally rotates token.",
		tick: async (node, bb) => {
			const lines = node.lines || [];
			if (!lines.length) return Status.SUCCESS;
			const line = lines[Math.floor(Math.random() * lines.length)];
			const name = bb.token.name || bb.actor.name;
			ChatMessage.create({
				user: game.user.id,
				speaker: { alias: name },
				content: `<div class="dc-patrol-emote"><strong>${name}:</strong> ${line}</div>`,
				style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
			});
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "lines", type: "text", label: "Emote Lines (semicolon-separated)", default: "" },
			],
		},
	});
}