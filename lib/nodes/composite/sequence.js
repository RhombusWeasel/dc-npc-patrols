/**
 * sequence.js — Composite: Sequence (AND)
 *
 * Stateful: runs children left-to-right, fails on first failure,
 * succeeds when all succeed. Remembers which child was running and
 * resumes from there on the next tick.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { warn_combat_once } from "../../bt_combat_log.js";
import { NODE_REGISTRY } from "../registry.js";

export function register() {
	register_node("sequence", {
		category: "composite",
		label: "Sequence (AND)",
		icon: "fa-solid fa-arrow-right",
		description: "Runs children in order. Fails if any child fails. Resumes from the running child.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_seq_${node._id}`);
			const children = node.children || [];
			let i = bb[key] ?? 0;
			for (; i < children.length; i++) {
				const status = await engine._tick_node(children[i], bb);
				if (status === Status.RUNNING) {
					bb[key] = i;
					return Status.RUNNING;
				}
				if (status === Status.FAILURE) {
					delete bb[key];
					const child = children[i];
					const label = child?._label || NODE_REGISTRY[child?.type]?.label || child?.type || "unknown";
					warn_combat_once(bb, `seq_${node._id}_${i}`, `sequence stopped at "${label}"`);
					return Status.FAILURE;
				}
				// SUCCESS — continue to next child
			}
			delete bb[key];
			return Status.SUCCESS;
		},
	});
}