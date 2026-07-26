/**
 * wait.js — Action: Wait
 *
 * Returns running for N real-world seconds, then succeeds.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";

export function register() {
	register_node("action_wait", {
		category: "action",
		label: "Action: Wait",
		icon: "fa-solid fa-hourglass",
		description: "Returns running for N real-world seconds, then succeeds.",
		tick: async (node, bb) => {
			const key = bb_state_key(bb, `_wait_${node._id}`);
			const now = Date.now();
			if (!bb[key]) bb[key] = now;
			const wait_ms = (parseInt(node.seconds, 10) || 5) * 1000;
			const elapsed = now - bb[key];
			if (elapsed >= wait_ms) {
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