/**
 * flag.js — Condition: Flag
 *
 * Checks an actor flag. Same operators as flag_condition boon.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _evaluate_operator } from "../../utils.js";

export function register() {
	register_node("condition_flag", {
		category: "condition",
		label: "Condition: Flag",
		icon: "fa-solid fa-flag",
		description: "Checks an actor flag. Same operators as flag_condition boon.",
		tick: async (node, bb) => {
			const actor = bb.actor;
			if (!actor) return Status.FAILURE;
			const scope = node.scope || 'dc-npc-patrols';
			const flag_path = node.flag_path || 'quest_flags';
			const key = node.flag_key;
			if (!key) return Status.FAILURE;
			const flag_root = actor.getFlag(scope, flag_path) || {};
			const actual = flag_root[key];
			return _evaluate_operator(actual, node.operator || 'exists', node.expected_value)
				? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "scope",        type: "text",    label: "Scope",        default: "dc-npc-patrols" },
				{ key: "flag_path",    type: "text",    label: "Flag Path",    default: "quest_flags" },
				{ key: "flag_key",     type: "text",    label: "Flag Key",     default: "" },
				{ key: "operator",     type: "dropdown", label: "Operator",   default: "exists",
					options: {
						exists: "Exists", not_exists: "Does Not Exist",
						equals: "Equals", not_equals: "Not Equals",
						greater: "Greater Than", less: "Less Than",
						greater_eq: "Greater or Equal", less_eq: "Less or Equal",
						contains: "Contains", starts_with: "Starts With",
					},
				},
				{ key: "expected_value", type: "text", label: "Expected Value", default: "" },
			],
		},
	});
}