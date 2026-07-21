/**
 * chat.js — Action: Chat
 *
 * Sends a chat message with optional dynamic placeholders.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _fill_placeholders } from "../../utils.js";

export function register() {
	register_node("action_chat", {
		category: "action",
		label: "Action: Chat",
		icon: "fa-solid fa-comment",
		description: "Sends a chat message with optional dynamic placeholders.",
		tick: async (node, bb) => {
			const text = _fill_placeholders(node.text || "", bb);
			if (!text) return Status.SUCCESS;

			const name = bb.token.name || bb.actor.name;
			const post_to_chat = node.post_to_chat ?? true;
			const post_as_bubble = node.post_as_bubble ?? false;

			if (post_to_chat) {
				ChatMessage.create({
					user: game.user.id,
					speaker: {
						alias: name,
						scene: bb.token.parent?.id,
						token: bb.token.id,
					},
					content: `<div class="dc-patrol-chat"><strong>${name}:</strong> ${text}</div>`,
					style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
				});
			}

			if (post_as_bubble && canvas?.ready && canvas.hud?.bubbles) {
				const token = canvas.tokens.get(bb.token.id);
				if (token) {
					await canvas.hud.bubbles.broadcast(bb.token, text, { cssClasses: ["emote"] });
				}
			}

			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "text", type: "text", label: "Chat Text", default: "" },
				{ key: "post_to_chat", type: "boolean", label: "Post to Chat Log", default: true },
				{ key: "post_as_bubble", type: "boolean", label: "Show Token Bubble", default: false },
			],
		},
	});
}