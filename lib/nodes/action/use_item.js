/**
 * use_item.js — Action: Use Item
 *
 * Uses an inventory item that has a top-level on_use boon (not attacks).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _fill_placeholders } from "../../utils.js";
import {
	resolve_gear_path,
	resolve_actor,
	use_item,
	get_gear_item,
} from "../../gear_actions.js";

export function register() {
	register_node("action_use_item", {
		category: "action",
		label: "Action: Use Item",
		icon: "fa-solid fa-hand-pointer",
		description: "Uses an inventory item that has a top-level on_use boon (partial label match).",
		tick: async (node, bb) => {
			if (!game.dc || !bb.actor) return Status.FAILURE;
			const actor = resolve_actor(bb.actor, bb.token);
			const label = _fill_placeholders(node.item_label || "", bb).trim();
			if (!label) return Status.FAILURE;

			const gear_path = resolve_gear_path(actor, label);
			if (!gear_path) return Status.FAILURE;

			const item = get_gear_item(actor, gear_path);
			if (!item || !game.dc.utils.has_boon_trigger(item, "on_use")) return Status.FAILURE;

			const ok = await use_item(actor, gear_path);
			return ok ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "item_label", type: "text", label: "Item Label", default: "" },
			],
		},
	});
}