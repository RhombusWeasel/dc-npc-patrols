/**
 * random_sequence.js — Composite: Random Sequence (AND)
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
	clear_move_state_on_abort,
	filter_executable_children,
} from "../../reactive_composite.js";

function _shuffle(arr) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

export function register() {
	register_node("random_sequence", {
		category: "composite",
		label: "Random Sequence (AND)",
		icon: "fa-solid fa-shuffle",
		description: "Shuffles children each pass. Fails if any child fails. Re-checks upstream conditions each tick while an action is running.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_rseq_${node._id}`);
			const children = filter_executable_children(node.children);
			let state = bb[key];
			if (!state) {
				state = { order: _shuffle(children.map((_, idx) => idx)), i: 0 };
				bb[key] = state;
			}

			if (state.i > 0) {
				const upstream = await recheck_upstream_ordered(
					children, state.order, state.i, bb, engine, "sequence",
				);
				const abort = handle_upstream_abort(upstream, key, bb);
				if (abort != null) return abort;
			}

			for (; state.i < state.order.length; state.i++) {
				const status = await engine._tick_node(children[state.order[state.i]], bb);
				if (status === Status.RUNNING) {
					return Status.RUNNING;
				}
				if (status === Status.FAILURE) {
					delete bb[key];
					clear_move_state_on_abort(bb);
					return Status.FAILURE;
				}
			}
			delete bb[key];
			return Status.SUCCESS;
		},
	});
}
