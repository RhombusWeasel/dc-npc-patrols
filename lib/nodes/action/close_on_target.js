/**
 * close_on_target.js — Action: Close On Target
 *
 * Paths toward a blackboard target until within range.
 * Use approach to chase or maintain to trail at distance.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { tick_close_on_target } from "../../target_movement.js";
import { get_measure_mode_options } from "../../token_target.js";

export function register() {
	register_node("action_close_on_target", {
		category: "action",
		label: "Action: Close On Target",
		icon: "fa-solid fa-person-walking-arrow-loop-left",
		description: "Paths toward a blackboard target until within range. Use approach to chase or maintain to trail at distance.",
		tick: async (node, bb, engine) => {
			if (bb.moving) return Status.RUNNING;

			const move_key = bb_state_key(bb, `_close_target_${node._id}`);
			const result = await tick_close_on_target(bb, engine, node, move_key);
			if (result === Status.SUCCESS) return Status.SUCCESS;
			if (result === Status.RUNNING) return Status.RUNNING;
			return Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
				{ key: "range", type: "number", label: "Range (grid squares)", default: 1 },
				{ key: "mode", type: "dropdown", label: "Mode", default: "approach",
					options: { approach: "Approach (chase)", maintain: "Maintain (trail)" },
				},
				{ key: "measure_mode", type: "dropdown", label: "Measure Mode", default: "combat_grid",
					options: get_measure_mode_options(),
				},
			],
		},
	});
}