/**
 * roll_gate.js — Action: Roll Gate
 *
 * Runs a Deadlands skill/trait/formula check and branches on the result.
 * Uses the system roll_gate_runner (dice roll + fate chip dialog + boons).
 *
 * Returns SUCCESS on a passed check, FAILURE on a failed check or when the
 * prompt is cancelled. Nested pass/fail/raise/crit_fail boons are applied
 * by the runner itself.
 *
 * This lets trees gate behaviour on a check — e.g. "guard rolls Scrutiny to
 * spot the sneaking player", "NPC attempts to pick the lock", "intimidation
 * check before the shopkeeper opens up".
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { resolve_actor_ref } from "../../token_target.js";
import { resolve_actor } from "../../gear_actions.js";
import { bt_log } from "../../bt_debug.js";

export function register() {
	register_node("action_roll_gate", {
		category: "action",
		label: "Action: Roll Gate",
		icon: "fa-solid fa-dice-d6",
		description: "Runs a Deadlands skill/trait/formula check (with fate chip dialog) and branches on the result. SUCCESS on pass, FAILURE on fail or cancel. Nested pass/fail/raise/crit-fail boons are applied by the runner.",
		tick: async (node, bb) => {
			if (!game.dc?.roll_gate_runner || !bb.actor) return Status.FAILURE;

			// Resolve the actor making the check.
			let actor = resolve_actor(bb.actor, bb.token);
			const target_key = (node.target_key || "").trim();
			if (target_key) {
				actor = resolve_actor_ref(bb, target_key) ?? actor;
			}
			if (!actor) return Status.FAILURE;

			const gate_def = {
				roll_mode: node.roll_mode || "trait",
				skill_key: node.skill_key || null,
				trait_key: node.trait_key || null,
				roll_formula: node.roll_formula || null,
				tn: node.tn ?? 5,
				modifier: node.modifier ?? 0,
				prompt_message: node.prompt_message || null,
				pass_boons: Array.isArray(node.pass_boons) ? node.pass_boons : [],
				fail_boons: Array.isArray(node.fail_boons) ? node.fail_boons : [],
				raise_boons: Array.isArray(node.raise_boons) ? node.raise_boons : [],
				crit_fail_boons: Array.isArray(node.crit_fail_boons) ? node.crit_fail_boons : [],
				target: "self",
			};

			const result = await game.dc.roll_gate_runner.run_gate(actor, gate_def, {
				context: game.dc.trigger_manager.create_context("bt", {
					actor,
					target: bb.actor,
					scene: bb.scene,
				}),
			});

			if (result?.cancelled) {
				bt_log("roll_gate", `actor=${actor.name} — prompt cancelled`);
				return Status.FAILURE;
			}

			bt_log("roll_gate", `actor=${actor.name} success=${result?.success} raises=${result?.raises} total=${result?.total}`);
			return result?.success ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "roll_mode", type: "dropdown", label: "Roll Mode", default: "trait",
					options: { skill: "Skill", trait: "Trait", formula: "Formula" },
				},
				{ key: "skill_key", type: "text", label: "Skill Key", default: "",
					condition: { field: "roll_mode", value: "skill" },
				},
				{ key: "trait_key", type: "text", label: "Trait Key", default: "spirit",
					condition: { field: "roll_mode", value: "trait" },
				},
				{ key: "roll_formula", type: "text", label: "Roll Formula", default: "",
					condition: { field: "roll_mode", value: "formula" },
				},
				{ key: "tn", type: "number", label: "Target Number (TN)", default: 5 },
				{ key: "modifier", type: "number", label: "Modifier", default: 0 },
				{ key: "prompt_message", type: "text", label: "Prompt Message (blank = default)", default: "" },
				{ key: "pass_boons", type: "boon_list", label: "Pass Boons", default: [] },
				{ key: "fail_boons", type: "boon_list", label: "Fail Boons", default: [] },
				{ key: "raise_boons", type: "boon_list", label: "Raise Boons", default: [] },
				{ key: "crit_fail_boons", type: "boon_list", label: "Crit Fail Boons", default: [] },
				{ key: "target_key", type: "text", label: "Target Blackboard Key (blank = self)", default: "" },
			],
		},
	});
}
