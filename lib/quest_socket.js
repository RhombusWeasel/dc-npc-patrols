/**
 * quests.js — dc-npc-patrols quests state, on the generic posse_state layer.
 *
 * Quest state is per-posse, stored in the system posse store under the
 * "quests" ext namespace (posse_api ext.quests). This file only wires the
 * namespace registration and provides quest-shaped helpers on top of the
 * generic bag API — transport, cache, and GM gating live in posse_state.js.
 *
 * Quest instance shape (value inside the "quests" bag, keyed by quest id):
 *   { id, title, giver, notes, stages: string[], vars: {key: value},
 *     stage: number, started: "YYYY-MM-DD"|null, completed: "YYYY-MM-DD"|null }
 */

import {
	register_posse_state,
	get_posse_state,
	request_posse_state,
	request_posse_state_write,
	register_posse_state_socket,
} from "./posse_state.js";

const QUESTS_NS = "quests";

/** Register socket + system ext hook. Call once from dcReady. */
function register_quests_state_socket() {
	register_posse_state_socket();
}

/**
 * Subscribe to quest-state changes (broadcast or local write).
 * @param {(posse_id: string, bag: Object) => void} fn
 * @returns {Function} unsubscribe
 */
function on_quests_change(fn) {
	return register_posse_state(QUESTS_NS, fn);
}

/**
 * Read a posse's quests from the cached namespace bag.
 * @param {string} posse_id
 * @returns {Object} quests map ({} when unknown)
 */
function get_cached_quests(posse_id) {
	return get_posse_state(posse_id, QUESTS_NS);
}

/**
 * Ask the GM to broadcast a posse's quest state; GM clients broadcast
 * immediately (priming their own cache).
 * @param {string} posse_id
 */
function request_quest_state(posse_id) {
	request_posse_state(posse_id, QUESTS_NS);
}

/**
 * Write quest state — GM direct path / player socket round-trip.
 * @param {"set"|"delete"} op
 * @param {{posse_id: string, quest_id: string, data?: Object}} payload
 * @returns {Promise<Object|null>} written bag on GM direct path, else null
 */
async function request_quest_write(op, { posse_id, quest_id, data } = {}) {
	const bag = { ...get_posse_state(posse_id, QUESTS_NS, { authoritative: true }) };
	if (op === "set") {
		bag[quest_id] = data;
	} else if (op === "delete") {
		delete bag[quest_id];
	} else {
		return null;
	}
	return request_posse_state_write(posse_id, QUESTS_NS, bag);
}

export {
	QUESTS_NS,
	register_quests_state_socket,
	on_quests_change,
	get_cached_quests,
	request_quest_state,
	request_quest_write,
};