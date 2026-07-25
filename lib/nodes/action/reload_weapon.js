/**
 * reload_weapon.js — Action: Reload Weapon
 *
 * Reloads the equipped weapon. Auto uses speed loading in combat
 * and full reload out of combat.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { warn_combat_once } from "../../bt_combat_log.js";
import { _fill_placeholders } from "../../utils.js";
import { resolve_actor } from "../../gear_actions.js";
import { reload_equipped_weapon, is_weapon_empty } from "../../combat_actions.js";
import { get_equip_slot_options } from "../../gear_actions.js";

export function register() {
	register_node("action_reload_weapon", {
		category: "action",
		label: "Action: Reload Weapon",
		icon: "fa-solid fa-rotate",
		description: "Reloads the equipped weapon. Auto uses speed loading in combat and full reload out of combat.",
		tick: async (node, bb) => {
			if (!game.dc || !bb.actor) return Status.FAILURE;

			const actor = resolve_actor(bb.actor, bb.token);
			const weapon_label = _fill_placeholders(node.weapon_label || "", bb).trim();
			const slot_key = node.slot_key || "main_hand";
			const mode = node.mode || "auto";
			const only_if_empty = node.only_if_empty !== false;

			// When only_if_empty is enabled (default), skip reload if the
			// weapon still has loaded rounds.  Return SUCCESS so the parent
			// sequence continues (e.g. proceeds to fire).
			if (only_if_empty && !is_weapon_empty(actor, {
				token_doc: bb.token,
				slot_key,
				weapon_label: weapon_label || undefined,
			})) {
				return Status.SUCCESS;
			}

			const result = await reload_equipped_weapon(actor, {
				token_doc: bb.token,
				slot_key,
				weapon_label: weapon_label || undefined,
				mode,
			});
			if (!result.ok) {
				const msg = result.reason ?? "unknown";
				console.warn(`dc-npc-patrols | action_reload_weapon failed for ${bb.actor.name}: ${msg}`);
				warn_combat_once(bb, "reload_weapon", `reload failed (${msg})`);
				return Status.FAILURE;
			}
			// Return FAILURE after a successful reload so parent selectors
			// break out — the NPC should reload OR fire this tick, not both.
			return Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "slot_key", type: "dropdown", label: "Weapon Slot", default: "main_hand",
					options: get_equip_slot_options(),
				},
				{ key: "weapon_label", type: "text", label: "Weapon Label Override (blank = slot)", default: "" },
				{ key: "mode", type: "dropdown", label: "Reload Mode", default: "auto",
					options: {
						auto: "Auto (speed load in combat)",
						full: "Full reload",
						one: "Load one round",
						speed_load: "Speed load (combat roll)",
					},
				},
				{ key: "only_if_empty", type: "boolean", label: "Only Reload If Empty", default: true,
					description: "When enabled (default), skip reloading if the weapon still has loaded rounds. After a successful reload, returns FAILURE so the parent selector breaks out (reload OR fire, not both).",
				},
			],
		},
	});
}