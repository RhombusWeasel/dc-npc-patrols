/**
 * acquire_target.js — Action: Acquire Target
 *
 * Finds the closest matching token and stores it on the blackboard.
 * Alternatively, in measure_only mode, measures distance to an existing
 * blackboard target and stores it as {target_key}_range.
 *
 * Replaces the legacy action_measure_range node.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { warn_combat_once } from "../../bt_combat_log.js";
import {
	find_closest_token,
	find_closest_from_records,
	write_target_to_blackboard,
	resolve_token_ref,
	measure_token_range,
	get_target_source_options,
	get_actor_type_options,
	get_disposition_options,
	get_measure_mode_options,
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
		description: "Finds the closest matching token and stores it on the blackboard, or measures range to an existing target.",
		tick: async (node, bb) => {
			if (!bb.token) return Status.FAILURE;

			const target_key = (node.target_key || "target").trim() || "target";

			// ── Measure-only mode ──────────────────────────────────
			if (node.measure_only) {
				const target_doc = resolve_token_ref(bb, target_key);
				if (!target_doc) return Status.FAILURE;
				const mode = node.measure_mode || "grid_squares";
				bb[`${target_key}_range`] = measure_token_range(bb.token, target_doc, mode);
				return Status.SUCCESS;
			}

			// ── Acquire mode ───────────────────────────────────────
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
				{ key: "measure_only", type: "boolean", label: "Measure Only (no acquisition)", default: false },
				{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
				{ key: "measure_mode", type: "dropdown", label: "Measure Mode", default: "grid_squares",
					options: get_measure_mode_options(),
					condition: { field: "measure_only", value: true },
				},
				{ key: "source", type: "dropdown", label: "Source", default: "scene_scan",
					options: get_target_source_options(),
					condition: { field: "measure_only", value: false },
				},
				{ key: "blackboard_key", type: "text", label: "List Blackboard Key", default: "visible_tokens",
					condition: { field: "measure_only", value: false },
				},
				{ key: "filter", type: "dropdown", label: "Filter", default: "all",
					options: get_token_filter_options(),
					condition: { field: "measure_only", value: false },
				},
				{ key: "actor_type", type: "dropdown", label: "Actor Type", default: "any",
					options: get_actor_type_options(),
					condition: { field: "measure_only", value: false },
				},
				{ key: "disposition", type: "dropdown", label: "Disposition", default: "any",
					options: get_disposition_options(),
					condition: { field: "measure_only", value: false },
				},
				{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0,
					condition: { field: "measure_only", value: false },
				},
				{ key: "name_contains", type: "text", label: "Name Contains", default: "",
					condition: { field: "measure_only", value: false },
				},
				{ key: "require_visible", type: "boolean", label: "Require Visible (scene scan only)", default: false,
					condition: { field: "measure_only", value: false },
				},
				{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true,
					condition: { field: "measure_only", value: false },
				},
				{ key: "prefer_same_level", type: "boolean", label: "Prefer Same Level", default: true,
					condition: { field: "measure_only", value: false },
				},
			],
		},
	});
}