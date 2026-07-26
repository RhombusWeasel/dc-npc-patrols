/**
 * reactive_composite.js — Shared upstream re-check helpers for stateful composites.
 *
 * Conditions must re-evaluate every tick even when a downstream action is RUNNING.
 * Action children still resume from saved index without restarting movement.
 */

import { Status } from "./bt_engine.js";
import { NODE_REGISTRY } from "./nodes/registry.js";
import { bb_state_key } from "./bt_state.js";

const SKIPPABLE_CONDITIONS = new Set(["condition_schedule", "condition_flag"]);

/**
 * @param {object|null} node
 * @returns {boolean}
 */
export function is_condition_node(node) {
	return NODE_REGISTRY[node?.type]?.category === "condition";
}

function _condition_input_key(node, bb) {
	if (node.type === "condition_schedule") {
		return `${bb.current_unixtime}|${bb.weekday}|${bb.weather}`;
	}
	if (node.type === "condition_flag") {
		const actor = bb.actor;
		if (!actor) return null;
		const scope = node.scope || "dc-npc-patrols";
		const flag_path = node.flag_path || "quest_flags";
		const key = node.flag_key;
		if (!key) return null;
		const flag_root = actor.getFlag(scope, flag_path) || {};
		return `${scope}|${flag_path}|${key}|${JSON.stringify(flag_root[key])}`;
	}
	return null;
}

async function _tick_upstream_child(node, bb, engine) {
	if (!SKIPPABLE_CONDITIONS.has(node?.type)) {
		return engine._tick_node(node, bb);
	}

	const input_key = _condition_input_key(node, bb);
	if (input_key == null) {
		return engine._tick_node(node, bb);
	}

	const cache_key = bb_state_key(bb, `_cond_recheck_${node._id}`);
	const cached = bb[cache_key];
	if (cached && cached.input_key === input_key) {
		return cached.status;
	}

	const status = await engine._tick_node(node, bb);
	bb[cache_key] = { input_key, status };
	return status;
}

/**
 * Re-tick upstream children for a sequence (AND) before resuming.
 * @returns {Promise<string|null>} abort status, or null if all upstream still SUCCESS
 */
export async function recheck_upstream_sequence(children, resume, bb, engine) {
	if (resume <= 0) return null;

	for (let i = 0; i < resume; i++) {
		const status = await _tick_upstream_child(children[i], bb, engine);
		if (bb.combat_turn_ended) return Status.SUCCESS;
		if (status === Status.FAILURE) return Status.FAILURE;
		if (status === Status.RUNNING) return Status.RUNNING;
	}
	return null;
}

/**
 * Re-tick upstream children for a selector (OR) before resuming.
 * @returns {Promise<string|null>} early SUCCESS/RUNNING, or null to continue resume
 */
export async function recheck_upstream_selector(children, resume, bb, engine) {
	if (resume <= 0) return null;

	for (let i = 0; i < resume; i++) {
		const status = await _tick_upstream_child(children[i], bb, engine);
		if (bb.combat_turn_ended) return Status.SUCCESS;
		if (status === Status.SUCCESS) return Status.SUCCESS;
		if (status === Status.RUNNING) return Status.RUNNING;
	}
	return null;
}

/**
 * Re-tick upstream children in shuffled order (random_sequence / random_selector).
 * @param {"sequence"|"selector"} mode
 * @returns {Promise<string|null>}
 */
export async function recheck_upstream_ordered(children, order, resume, bb, engine, mode) {
	if (resume <= 0) return null;

	for (let j = 0; j < resume; j++) {
		const status = await _tick_upstream_child(children[order[j]], bb, engine);
		if (bb.combat_turn_ended) return Status.SUCCESS;
		if (mode === "sequence") {
			if (status === Status.FAILURE) return Status.FAILURE;
			if (status === Status.RUNNING) return Status.RUNNING;
		} else {
			if (status === Status.SUCCESS) return Status.SUCCESS;
			if (status === Status.RUNNING) return Status.RUNNING;
		}
	}
	return null;
}

/**
 * Remove active movement path state when a gated branch aborts mid-run.
 * Only clears keys under the current tick scope so sibling selector branches
 * keep their in-progress paths during upstream re-checks.
 * @param {object} bb
 * @param {string|null} [scope_prefix] — defaults to bb._tick_scope
 */
export function clear_move_state_on_abort(bb, scope_prefix = null) {
	if (!bb) return;

	const prefix = scope_prefix ?? bb._tick_scope ?? "";
	for (const key of Object.keys(bb)) {
		if (prefix && !key.startsWith(prefix)) continue;
		const state = bb[key];
		if (!state || !Array.isArray(state.path) || typeof state.index !== "number") continue;
		delete bb[key];
	}
}

/**
 * @param {string|null} upstream_status
 * @param {string} state_key
 * @param {object} bb
 * @returns {string|null} composite status to return, or null to continue
 */
export function handle_upstream_abort(upstream_status, state_key, bb) {
	if (upstream_status == null) return null;

	if (upstream_status === Status.FAILURE) {
		delete bb[state_key];
		clear_move_state_on_abort(bb);
		return Status.FAILURE;
	}

	if (upstream_status === Status.RUNNING) {
		return Status.RUNNING;
	}

	if (upstream_status === Status.SUCCESS) {
		delete bb[state_key];
		return Status.SUCCESS;
	}

	return null;
}
