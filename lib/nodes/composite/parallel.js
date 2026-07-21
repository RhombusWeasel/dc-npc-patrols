/**
 * parallel.js — Composite: Parallel
 *
 * Stateful: run all children. Succeeds when N of M succeed.
 * Fails if (M - N + 1) children fail (i.e. success is impossible).
 * Completed children are not re-ticked.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";

export function register() {
	register_node("parallel", {
		category: "composite",
		label: "Parallel",
		icon: "fa-solid fa-bars",
		description: "Runs children simultaneously. Succeeds when N succeed. Completed children are not re-ticked.",
		tick: async (node, bb, engine) => {
			const children = node.children || [];
			const required = node.required ?? children.length;
			const key = bb_state_key(bb, `_par_${node._id}`);
			let state = bb[key] ?? { successes: 0, failures: 0, done: {} };
			for (let i = 0; i < children.length; i++) {
				if (state.done[i]) continue;
				const status = await engine._tick_node(children[i], bb);
				if (status === Status.SUCCESS) {
					state.successes++;
					state.done[i] = true;
				}
				if (status === Status.FAILURE) {
					state.failures++;
					state.done[i] = true;
				}
			}
			if (state.successes >= required) {
				delete bb[key];
				return Status.SUCCESS;
			}
			if (state.failures > children.length - required) {
				delete bb[key];
				return Status.FAILURE;
			}
			bb[key] = state;
			return Status.RUNNING;
		},
	});
}