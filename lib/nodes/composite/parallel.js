/**
 * parallel.js — Composite: Parallel
 *
 * Reactive: condition children are re-ticked every tick even when marked
 * done. Action children resume until SUCCESS/FAILURE.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { bb_state_key } from "../../bt_state.js";
import { is_condition_node, clear_move_state_on_abort } from "../../reactive_composite.js";

function _apply_status(state, i, status) {
	if (status === Status.SUCCESS) {
		state.successes++;
		state.done[i] = true;
	} else if (status === Status.FAILURE) {
		state.failures++;
		state.done[i] = true;
	}
	state.last_status[i] = status;
}

function _revoke_status(state, i) {
	const prev = state.last_status[i];
	if (prev === Status.SUCCESS) state.successes--;
	else if (prev === Status.FAILURE) state.failures--;
	delete state.last_status[i];
	state.done[i] = false;
}

export function register() {
	register_node("parallel", {
		category: "composite",
		label: "Parallel",
		icon: "fa-solid fa-bars",
		description: "Runs children simultaneously. Succeeds when N succeed. Re-checks condition children each tick.",
		tick: async (node, bb, engine) => {
			const children = node.children || [];
			const required = node.required ?? children.length;
			const key = bb_state_key(bb, `_par_${node._id}`);
			let state = bb[key] ?? { successes: 0, failures: 0, done: {}, last_status: {} };

			for (let i = 0; i < children.length; i++) {
				const is_cond = is_condition_node(children[i]);
				if (state.done[i] && !is_cond) continue;

				const status = await engine._tick_node(children[i], bb);

				if (is_cond && state.last_status[i] != null) {
					const prev = state.last_status[i];
					if (prev === status) continue;
					_revoke_status(state, i);
					if (status === Status.SUCCESS || status === Status.FAILURE) {
						_apply_status(state, i, status);
					}
					continue;
				}

				if (status === Status.SUCCESS || status === Status.FAILURE) {
					_apply_status(state, i, status);
				}
			}

			if (state.successes >= required) {
				delete bb[key];
				return Status.SUCCESS;
			}
			if (state.failures > children.length - required) {
				delete bb[key];
				clear_move_state_on_abort(bb);
				return Status.FAILURE;
			}
			bb[key] = state;
			return Status.RUNNING;
		},
	});
}
