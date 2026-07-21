/**
 * fire_weapon.js — Action: Fire Weapon
 *
 * Fires the equipped weapon at a blackboard target.
 * No range gate — Deadlands applies range increment penalties on the roll.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _fill_placeholders } from "../../utils.js";
import { resolve_token_ref } from "../../token_target.js";
import { get_equip_slot_options } from "../../gear_actions.js";

export function register() {
	register_node("action_fire_weapon", {
		category: "action",
		label: "Action: Fire Weapon",
		icon: "fa-solid fa-gun",
		description: "Fires the equipped weapon at a blackboard target. No range gate — Deadlands applies range increment penalties on the roll.",
		tick: async (node, bb) => {
			if (!game.dc || !bb.actor || !bb.token) return Status.FAILURE;

			const target_key = (node.target_key || "target").trim() || "target";
			const target_doc = resolve_token_ref(bb, target_key);
			if (!target_doc) return Status.FAILURE;

			const weapon_label = _fill_placeholders(node.weapon_label || "", bb).trim();
			if (!game.dc?.combat_attack?.fire) return Status.FAILURE;
			const result = await game.dc.combat_attack.fire(bb.actor, {
				attacker_token_id: bb.token.id,
				target_token_id: target_doc.id,
				slot_key: node.slot_key || "main_hand",
				weapon_label: weapon_label || undefined,
			});
			if (!result.ok) {
				console.warn(`dc-npc-patrols | action_fire_weapon failed for ${bb.actor.name}: ${result.reason}`);
			}
			return result.ok ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
				{ key: "slot_key", type: "dropdown", label: "Weapon Slot", default: "main_hand",
					options: get_equip_slot_options(),
				},
				{ key: "weapon_label", type: "text", label: "Weapon Label Override (blank = slot)", default: "" },
			],
		},
	});
}