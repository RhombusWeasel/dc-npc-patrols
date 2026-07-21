/**
 * wait.js — Action: Wait
 *
 * Returns running for N seconds, then succeeds.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";

export function register() {
	register_node("action_wait", {
		category: "action",
		label: "Action: Wait",
		icon: "fa-solid fa-hourglass",
		description: "Returns running for N seconds, then succeeds.",
		tick: async (node, bb) => {
			const key = bb_state_key(bb, `_wait_${node._id}`);
			if (!bb[key]) bb[key] = bb.current_unixtime;
			const elapsed = bb.current_unixtime - bb[key];
			if (elapsed >= (node.seconds ?? 5)) {
				delete bb[key];
				return Status.SUCCESS;
			}
			return Status.RUNNING;
		},
		editor: {
			fields: [
				{ key: "seconds", type: "number", label: "Wait (seconds)", default: 5 },
			],
		},
	});
}