/**
 * sequence.js — Composite: Sequence (AND)
 *
 * Reactive: re-evaluates upstream children each tick before resuming a
 * RUNNING child. Fails on first failure, succeeds when all succeed.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { warn_combat_once } from "../../bt_combat_log.js";
import { NODE_REGISTRY } from "../registry.js";
import {
	recheck_upstream_sequence,
	handle_upstream_abort,
	clear_move_state_on_abort,
} from "../../reactive_composite.js";

export function register() {
	register_node("sequence", {
		category: "composite",
		label: "Sequence (AND)",
		icon: "fa-solid fa-arrow-right",
		description: "Runs children in order. Fails if any child fails. Re-checks upstream conditions each tick while an action is running.",
		tick: async (node, bb, engine) => {
			const key = bb_state_key(bb, `_seq_${node._id}`);
			const children = node.children || [];
			let i = bb[key] ?? 0;

			if (i > 0) {
				const upstream = await recheck_upstream_sequence(children, i, bb, engine);
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
				if (status === Status.FAILURE) {
					delete bb[key];
					clear_move_state_on_abort(bb);
					const child = children[i];
					const label = child?._label || NODE_REGISTRY[child?.type]?.label || child?.type || "unknown";
					warn_combat_once(bb, `seq_${node._id}_${i}`, `sequence stopped at "${label}"`);
					return Status.FAILURE;
				}
			}
			delete bb[key];
			return Status.SUCCESS;
		},
	});
}
