/**
 * visible_tokens.js — Condition: Visible Tokens
 *
 * Checks the blackboard visible-token list (optionally refreshes first).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	get_visible_tokens,
	filter_token_records,
	write_visible_tokens_to_blackboard,
	get_token_filter_options,
} from "../../token_vision.js";

export function register() {
	register_node("condition_visible_tokens", {
		category: "condition",
		label: "Condition: Visible Tokens",
		icon: "fa-solid fa-binoculars",
		description: "Checks the blackboard visible-token list (optionally refreshes first).",
		tick: async (node, bb) => {
			const key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";

			if (node.refresh) {
				const scan = get_visible_tokens(bb.token, {
					filter: node.filter || "all",
					max_range: node.max_range ?? 0,
					include_self: node.include_self ?? false,
					exclude_hidden: node.exclude_hidden ?? true,
				});
				if (!scan.ok) return Status.FAILURE;
				write_visible_tokens_to_blackboard(bb, scan.tokens, key, bb.current_unixtime);
			}

			const filtered = filter_token_records(bb[key], {
				filter: node.filter || "all",
				name_contains: node.name_contains || "",
			});
			const min_count = node.min_count ?? 1;
			return filtered.length >= min_count ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "blackboard_key", type: "text", label: "Blackboard Key", default: "visible_tokens" },
				{ key: "min_count", type: "number", label: "Minimum Matches", default: 1 },
				{ key: "filter", type: "dropdown", label: "Filter", default: "all",
					options: get_token_filter_options(),
				},
				{ key: "name_contains", type: "text", label: "Name Contains", default: "" },
				{ key: "refresh", type: "boolean", label: "Refresh Before Check", default: false },
				{ key: "max_range", type: "number", label: "Refresh Max Range (squares, 0=unlimited)", default: 0 },
				{ key: "include_self", type: "boolean", label: "Refresh Include Self", default: false },
				{ key: "exclude_hidden", type: "boolean", label: "Refresh Exclude Hidden", default: true },
			],
		},
	});
}