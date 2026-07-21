/**
 * equip_item.js — Action: Equip Item
 *
 * Equips or unequips an inventory item matched by label
 * (supports {{var}} placeholders).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _fill_placeholders } from "../../utils.js";
import {
	resolve_gear_path,
	resolve_actor,
	equip_item,
	unequip_item,
	is_gear_equipped,
	get_equip_slot_options,
} from "../../gear_actions.js";

export function register() {
	register_node("action_equip_item", {
		category: "action",
		label: "Action: Equip Item",
		icon: "fa-solid fa-shirt",
		description: "Equips or unequips an inventory item matched by label (supports {{var}} placeholders).",
		tick: async (node, bb) => {
			if (!game.dc || !bb.actor) return Status.FAILURE;
			const actor = resolve_actor(bb.actor, bb.token);
			const label = _fill_placeholders(node.item_label || "", bb).trim();
			if (!label) return Status.FAILURE;

			const gear_path = resolve_gear_path(actor, label);
			if (!gear_path) return Status.FAILURE;

			const mode = node.mode || "equip";
			if (mode !== "unequip" && is_gear_equipped(actor, gear_path)) {
				return Status.SUCCESS;
			}

			const result = mode === "unequip"
				? await unequip_item(actor, gear_path)
				: await equip_item(actor, gear_path, node.equip_slot || "auto");
			return result.ok ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "item_label", type: "text", label: "Item Label", default: "" },
				{ key: "mode", type: "dropdown", label: "Mode", default: "equip",
					options: { equip: "Equip", unequip: "Unequip" },
				},
				{ key: "equip_slot", type: "dropdown", label: "Equip Slot", default: "auto",
					options: get_equip_slot_options(),
				},
			],
		},
	});
}