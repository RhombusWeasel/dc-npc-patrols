/**
 * subtree.js — Reference: Fragment Link
 *
 * Live reference to a fragment. Ticks the fragment root at runtime.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { get_bt } from "../../bt_store.js";
import { resolve_variables_for_defs } from "../../bt_variables.js";

export function register() {
	register_node("subtree", {
		category: "reference",
		label: "Fragment Link",
		icon: "fa-solid fa-link",
		description: "Live reference to a fragment. Ticks the fragment root at runtime.",
		tick: async (node, bb, engine) => {
			const fragment_id = (node.bt_id || "").trim();
			if (!fragment_id) return Status.FAILURE;

			const fragment = get_bt(fragment_id);
			if (!fragment?.root) return Status.FAILURE;

			const prev_scope = bb._tick_scope ?? "";
			const prev_vars = bb.variables;
			const scope_prefix = `${prev_scope}${node._id}/`;
			bb._tick_scope = scope_prefix;
			bb.variables = {
				...prev_vars,
				...resolve_variables_for_defs(bb.actor, fragment.variables || []),
			};

			const fragment_root = foundry.utils.deepClone(fragment.root);
			try {
				engine._ensure_node_ids(fragment_root, `${scope_prefix}r`);
				return await engine._tick_node(fragment_root, bb);
			} finally {
				bb._tick_scope = prev_scope;
				bb.variables = prev_vars;
			}
		},
		editor: {
			fields: [
				{ key: "bt_id", type: "fragment_select", label: "Fragment", default: "" },
			],
		},
	});
}