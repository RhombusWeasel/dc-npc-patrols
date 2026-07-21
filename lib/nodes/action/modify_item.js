/**
 * modify_item.js — Action: Modify Item
 *
 * Adds or removes inventory items matched by partial label
 * on self or a blackboard target actor.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _fill_placeholders } from "../../utils.js";
import { resolve_actor } from "../../gear_actions.js";
import { resolve_actor_ref } from "../../token_target.js";
import { modify_item_by_label, remove_item_by_label } from "../../inventory_actions.js";

export function register() {
	register_node("action_modify_item", {
		category: "action",
		label: "Action: Modify Item",
		icon: "fa-solid fa-box",
		description: "Adds or removes inventory items matched by partial label on self or a blackboard target actor.",
		tick: async (node, bb) => {
			if (!game.dc) return Status.FAILURE;

			const label = _fill_placeholders(node.item_label || "", bb).trim();
			if (!label) return Status.FAILURE;

			let actor = resolve_actor(bb.actor, bb.token);
			const target_key = (node.target_key || "").trim();
			if (target_key) {
				actor = resolve_actor_ref(bb, target_key) ?? actor;
			}
			if (!actor) return Status.FAILURE;

			const mode = node.mode || "add";
			const quantity = node.quantity ?? 1;
			const result = mode === "remove"
				? await remove_item_by_label(actor, label, quantity)
				: await modify_item_by_label(actor, label, quantity);
			return result.ok ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "item_label", type: "text", label: "Item Label", default: "" },
				{ key: "mode", type: "dropdown", label: "Mode", default: "add",
					options: { add: "Add", remove: "Remove" },
				},
				{ key: "quantity", type: "number", label: "Quantity", default: 1 },
				{ key: "target_key", type: "text", label: "Target Blackboard Key (blank = self)", default: "" },
			],
		},
	});
}