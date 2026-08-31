/**
 * fire_boons.js — Action: Fire Boons
 *
 * Fires a list of Deadlands boons through the system boon pipeline
 * (create_context → handleBoon → resolve_context → process_pending_roll_gates).
 *
 * This exposes the full boon system to behaviour trees: deal_damage,
 * heal_damage, apply_status, teleport, modify_light, add_pool, mod_trait,
 * mod_skill, saving_throw, modify_gear, and any module-registered boon type.
 *
 * Boons fire against the NPC actor (self) or a blackboard target actor.
 * Roll gates collected during firing are processed asynchronously (dice +
 * fate chip dialog) before the node returns.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { resolve_actor_ref } from "../../token_target.js";
import { resolve_actor } from "../../gear_actions.js";
import { bt_log } from "../../bt_debug.js";

export function register() {
	register_node("action_fire_boons", {
		category: "action",
		label: "Action: Fire Boons",
		icon: "fa-solid fa-wand-magic-sparkles",
		description: "Fires a list of Deadlands boons (damage, healing, statuses, teleport, pool/trait/skill changes, roll gates, etc.) against the NPC or a blackboard target. Uses the system boon pipeline.",
		tick: async (node, bb) => {
			if (!game.dc || !bb.actor) return Status.FAILURE;

			const boons = Array.isArray(node.boons) ? node.boons : [];
			if (!boons.length) return Status.SUCCESS;

			// Resolve the actor the boons fire against.
			let actor = resolve_actor(bb.actor, bb.token);
			const target_key = (node.target_key || "").trim();
			if (target_key) {
				actor = resolve_actor_ref(bb, target_key) ?? actor;
			}
			if (!actor) return Status.FAILURE;

			const context = game.dc.trigger_manager.create_context("bt", {
				actor,
				target: bb.actor,
				scene: bb.scene,
			});

			for (const boon of boons) {
				await game.dc.boon_manager.handleBoon(boon, context);
			}

			// Resolve accumulated effects (damage, healing, statuses, updates, flags, gear).
			await game.dc.resolve_context.resolve_context(actor, context);

			// Process pending roll gates (async: dice + fate chip dialog).
			if (context.pending_roll_gates?.length) {
				await game.dc.trigger_manager.process_pending_roll_gates(actor, context);
			}

			bt_log("fire_boons", `actor=${actor.name} boons=${boons.length}`);
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "boons", type: "boon_list", label: "Boons", default: [] },
				{ key: "target_key", type: "text", label: "Target Blackboard Key (blank = self)", default: "" },
			],
		},
	});
}
