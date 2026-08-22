/**
 * set_variable.js — Action: Set Variable
 *
 * Writes a runtime value into the NPC's behaviour-tree variable map
 * (bb.variables), readable back with Condition: Variable. Values are
 * coerced by type (text/number/boolean). This is a per-NPC runtime
 * override — it does not persist to the actor's bt_variables flag, so
 * it's instanced to this NPC and reset when their blackboard is rebuilt.
 *
 * Mirror of action_set_blackboard, but targeting tree variables.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _resolve_value } from "../../utils.js";

export function register() {
	register_node("action_set_variable", {
		category: "action",
		label: "Action: Set Variable",
		icon: "fa-solid fa-bullseye",
		description: "Sets a behaviour-tree variable's runtime value (readable by Condition: Variable). Per-NPC instance.",
		tick: async (node, bb) => {
			const key = (node.variable_key || "").trim();
			if (!key) return Status.FAILURE;

			let value = _resolve_value(node.value, bb.variables || {});
			const value_type = node.value_type || "text";

			if (value_type === "number") {
				value = Number(value);
				if (Number.isNaN(value)) value = 0;
			} else if (value_type === "boolean") {
				value = value === true
					|| String(value).toLowerCase() === "true"
					|| value === 1
					|| value === "1";
			} else {
				value = String(value ?? "");
			}

			bb.variables[key] = value;
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "variable_key", type: "text", label: "Variable Key", default: "" },
				{ key: "value", type: "text", label: "Value", default: "" },
				{
					key: "value_type",
					type: "dropdown",
					label: "Value Type",
					default: "text",
					options: { text: "Text", number: "Number", boolean: "Boolean" },
				},
			],
		},
		// variable_key is a literal key name — must not be template-resolved
		no_resolve: ["variable_key"],
	});
}
