/**
 * selector.js — Composite: Selector (OR)
 *
 * Reactive: re-evaluates upstream children each tick before resuming a
 * RUNNING child. Succeeds on first success, fails if all children fail.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import {
	recheck_upstream_selector,
	handle_upstream_abort,
	filter_executable_children,
} from "../../reactive_composite.js";

export function register() {
	register_node("selector", {
		category: "composite",
		label: "Selector (OR)",
		icon: "fa-solid fa-question",
		description: "Tries children in order. Succeeds on first success. Re-checks upstream conditions each tick while an action is running.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_sel_${node._id}`);
			const children = filter_executable_children(node.children);
			let i = bb[key] ?? 0;

			if (i > 0) {
				const upstream = await recheck_upstream_selector(children, i, bb, engine);
				const abort = handle_upstream_abort(upstream, key, bb);
				if (abort != null) return abort;
			}

			for (; i < children.length; i++) {
				const status = await engine._tick_node(children[i], bb);
				if (bb.combat_turn_ended) {
					delete bb[key];
					return Status.SUCCESS;
				}
				if (status === Status.RUNNING) {
					bb[key] = i;
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
