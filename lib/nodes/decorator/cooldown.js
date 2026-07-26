/**
 * cooldown.js — Decorator: Cooldown
 *
 * Prevents child re-execution for N real-world seconds after success.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";

export function register() {
	register_node("cooldown", {
		category: "decorator",
		label: "Cooldown",
		icon: "fa-solid fa-clock",
		description: "Prevents re-execution for N real-world seconds after success.",
		tick: async (node, bb, engine) => {
			if (!node.child) return Status.SUCCESS;

			const now = Date.now();
			const key = bb_state_key(bb, `_cooldown_${node._id}`);
			const last = bb[key] ?? 0;
			const cooldown_ms = (parseInt(node.seconds, 10) || 60) * 1000;

			if (last && now - last < cooldown_ms) return Status.RUNNING;

			const status = await engine._tick_node(node.child, bb);
			if (status === Status.SUCCESS) bb[key] = now;
			if (status === Status.FAILURE) return Status.SUCCESS;
			return status;
		},
		editor: {
			fields: [
				{ key: "seconds", type: "number", label: "Cooldown (seconds)", default: 60 },
			],
		},
	});
}