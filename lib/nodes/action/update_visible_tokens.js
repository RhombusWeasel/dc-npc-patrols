/**
 * update_visible_tokens.js — Action: Update Visible Tokens
 *
 * Scans Foundry token vision and writes visible tokens to the blackboard.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	get_visible_tokens,
	write_visible_tokens_to_blackboard,
	get_token_filter_options,
} from "../../token_vision.js";

export function register() {
	register_node("action_update_visible_tokens", {
		category: "action",
		label: "Action: Update Visible Tokens",
		icon: "fa-solid fa-binoculars",
		description: "Scans Foundry token vision and writes visible tokens to the blackboard.",
		tick: async (node, bb) => {
			const key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";
			const scan = get_visible_tokens(bb.token, {
				filter: node.filter || "all",
				max_range: node.max_range ?? 0,
				include_self: node.include_self ?? false,
				exclude_hidden: node.exclude_hidden ?? true,
			});
			if (!scan.ok) return Status.FAILURE;
			write_visible_tokens_to_blackboard(bb, scan.tokens, key, bb.current_unixtime);
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "blackboard_key", type: "text", label: "Blackboard Key", default: "visible_tokens" },
				{ key: "filter", type: "dropdown", label: "Filter", default: "all",
					options: get_token_filter_options(),
				},
				{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0 },
				{ key: "include_self", type: "boolean", label: "Include Self", default: false },
				{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true },
			],
		},
	});
}