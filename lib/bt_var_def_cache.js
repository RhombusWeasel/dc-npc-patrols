/**
 * bt_var_def_cache.js — Memoized collect_variable_defs per behaviour tree.
 */

import { collect_variable_defs } from "./bt_subtree.js";
import { get_bts } from "./bt_store.js";

/** @type {Map<string, { hash: number, defs: object[] }>} */
const _cache = new Map();

function _bt_hash(bt_id, bts) {
	const tree = bts[bt_id];
	if (!tree) return 0;
	return foundry.utils.hashCode(JSON.stringify(tree));
}

/**
 * @param {string} bt_id
 * @returns {object[]}
 */
export function get_cached_variable_defs(bt_id) {
	if (!bt_id) return [];
	const bts = get_bts();
	const hash = _bt_hash(bt_id, bts);
	const cached = _cache.get(bt_id);
	if (cached?.hash === hash) return cached.defs;

	const defs = collect_variable_defs(bt_id, bts);
	_cache.set(bt_id, { hash, defs });
	return defs;
}

/**
 * @param {string} [bt_id]
 */
export function invalidate_var_def_cache(bt_id) {
	if (bt_id) _cache.delete(bt_id);
	else _cache.clear();
}

/**
 * Invalidate all variable-def entries (behaviour_trees setting changed).
 */
export function invalidate_all_var_def_cache() {
	_cache.clear();
}
