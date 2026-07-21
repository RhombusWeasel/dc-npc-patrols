/**
 * random_selector.js — Composite: Random Selector (OR)
 *
 * Like a Selector, but shuffles the children into a random order each
 * time the composite starts a fresh pass. Succeeds on the first child
 * that succeeds, fails if every child fails. Remembers the shuffled
 * order and resumes from the running child on the next tick.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";

function _shuffle(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

export function register() {
	register_node("random_selector", {
		category: "composite",
		label: "Random Selector (OR)",
		icon: "fa-solid fa-shuffle",
		description: "Shuffles children each pass. Succeeds on first success. Resumes from the running child.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_rsel_${node._id}`);
			const children = node.children || [];
			let state = bb[key];
			if (!state) {
				state = { order: _shuffle(children.map((_, i) => i)), i: 0 };
				bb[key] = state;
			}
			for (; state.i < state.order.length; state.i++) {
				const status = await engine._tick_node(children[state.order[state.i]], bb);
				if (status === Status.RUNNING) {
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