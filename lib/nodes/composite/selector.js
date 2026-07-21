/**
 * selector.js — Composite: Selector (OR)
 *
 * Stateful: runs children left-to-right, succeeds on first success.
 * Fails if all children fail. Remembers which child was running and
 * resumes from there on the next tick.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";

export function register() {
	register_node("selector", {
		category: "composite",
		label: "Selector (OR)",
		icon: "fa-solid fa-question",
		description: "Tries children in order. Succeeds on first success. Resumes from the running child.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_sel_${node._id}`);
			const children = node.children || [];
			let i = bb[key] ?? 0;
			for (; i < children.length; i++) {
				const status = await engine._tick_node(children[i], bb);
				if (status === Status.RUNNING) {
					bb[key] = i;
					return Status.RUNNING;
				}
				if (status === Status.SUCCESS) {
					delete bb[key];
					return Status.SUCCESS;
				}
				// FAILURE — continue to next child
			}
			delete bb[key];
			return Status.FAILURE;
		},
	});
}