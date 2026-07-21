/**
 * acquire_target.js — Action: Acquire Target
 *
 * Finds the closest matching token and stores it on the blackboard.
 * Blackboard List reads a pre-built list (use Update Visible Tokens first,
 * or leave Source on Scene Scan).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { warn_combat_once } from "../../bt_combat_log.js";
import {
	find_closest_token,
	find_closest_from_records,
	write_target_to_blackboard,
	get_target_source_options,
	get_actor_type_options,
	get_disposition_options,
} from "../../token_target.js";
import { get_visible_tokens, get_token_filter_options } from "../../token_vision.js";

function _target_filter_options(node) {
	return {
		filter: node.filter || "all",
		actor_type: node.actor_type || "any",
		disposition: node.disposition || "any",
		max_range: node.max_range ?? 0,
		name_contains: node.name_contains || "",
		exclude_hidden: node.exclude_hidden ?? true,
		prefer_same_level: node.prefer_same_level ?? true,
	};
}

export function register() {
	register_node("action_acquire_target", {
		category: "action",
		label: "Action: Acquire Target",
		icon: "fa-solid fa-crosshairs",
		description: "Finds the closest matching token and stores it on the blackboard. Blackboard List reads a pre-built list (use Update Visible Tokens first, or leave Source on Scene Scan).",
		tick: async (node, bb) => {
			if (!bb.token) return Status.FAILURE;

			const target_key = (node.target_key || "target").trim() || "target";
			const source = node.source || "scene_scan";
			const filter_opts = _target_filter_options(node);
			let record = null;

			if (source === "blackboard_list") {
				const list_key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";
				const list = bb[list_key];
				if (Array.isArray(list) && list.length > 0) {
					record = find_closest_from_records(list, bb.token, filter_opts);
				}
				if (!record) {
					warn_combat_once(
						bb,
						"acquire_empty_list",
						`token list "${list_key}" empty or no match — scanning scene instead`,
					);
					record = find_closest_token(bb.token, filter_opts);
				}
			} else if (node.require_visible) {
				const scan = get_visible_tokens(bb.token, {
					filter: filter_opts.filter,
					max_range: filter_opts.max_range,
					include_self: false,
					exclude_hidden: filter_opts.exclude_hidden,
				});
				if (scan.ok) {
					record = find_closest_from_records(scan.tokens, bb.token, filter_opts);
				}
			} else {
				record = find_closest_token(bb.token, filter_opts);
			}

			if (!record) {
				warn_combat_once(bb, "acquire_target", "no matching target found (check filter/disposition/range)");
				return Status.FAILURE;
			}
			write_target_to_blackboard(bb, record, target_key);
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
				{ key: "source", type: "dropdown", label: "Source", default: "scene_scan",
					options: get_target_source_options(),
				},
				{ key: "blackboard_key", type: "text", label: "List Blackboard Key", default: "visible_tokens" },
				{ key: "filter", type: "dropdown", label: "Filter", default: "all",
					options: get_token_filter_options(),
				},
				{ key: "actor_type", type: "dropdown", label: "Actor Type", default: "any",
					options: get_actor_type_options(),
				},
				{ key: "disposition", type: "dropdown", label: "Disposition", default: "any",
					options: get_disposition_options(),
				},
				{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0 },
				{ key: "name_contains", type: "text", label: "Name Contains", default: "" },
				{ key: "require_visible", type: "boolean", label: "Require Visible (scene scan only)", default: false },
				{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true },
				{ key: "prefer_same_level", type: "boolean", label: "Prefer Same Level", default: true },
			],
		},
	});
}