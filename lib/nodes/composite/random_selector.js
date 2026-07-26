/**
 * random_selector.js — Composite: Random Selector (OR)
 *
 * Reactive: re-evaluates upstream children in shuffled order each tick
 * before resuming a RUNNING child.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import {
	recheck_upstream_ordered,
	handle_upstream_abort,
} from "../../reactive_composite.js";

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
		description: "Shuffles children each pass. Succeeds on first success. Re-checks upstream conditions each tick while an action is running.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_rsel_${node._id}`);
			const children = node.children || [];
			let state = bb[key];
			if (!state) {
				state = { order: _shuffle(children.map((_, idx) => idx)), i: 0 };
				bb[key] = state;
			}

			if (state.i > 0) {
				const upstream = await recheck_upstream_ordered(
					children, state.order, state.i, bb, engine, "selector",
				);
				const abort = handle_upstream_abort(upstream, key, bb);
				if (abort != null) return abort;
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
			}
			delete bb[key];
			return Status.FAILURE;
		},
	});
}
