/**
 * combat.js — Condition: Combat
 *
 * Checks combat state: is combat active, is it my turn, or do I have
 * movement budget remaining.
 * Replaces the legacy condition_combat, condition_my_turn, and
 * condition_can_move nodes.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { has_movement_budget } from "../../combat_movement.js";

export function register() {
	register_node("condition_combat", {
		category: "condition",
		label: "Condition: Combat",
		icon: "fa-solid fa-swords",
		description: "Checks combat state: active, my turn, or movement budget remaining.",
		tick: async (node, bb) => {
			const check = node.check || "active";

			if (check === "active") {
				return bb.combat_active ? Status.SUCCESS : Status.FAILURE;
			}

			if (check === "my_turn") {
				return bb.is_my_turn ? Status.SUCCESS : Status.FAILURE;
			}

			if (check === "can_move") {
				const mode = bb.movement_mode || "normal";
				return has_movement_budget(bb, mode) ? Status.SUCCESS : Status.FAILURE;
			}

			return Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "check", type: "dropdown", label: "Check", default: "active",
					options: [
						{ value: "active", label: "Combat Active" },
						{ value: "my_turn", label: "My Turn" },
						{ value: "can_move", label: "Can Move (has budget)" },
					],
				},
			],
		},
	});
}