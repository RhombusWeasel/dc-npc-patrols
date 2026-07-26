/**
 * bt_tree_cache.js — Prepared behaviour tree roots (repair, migrate, node ids).
 */

import { get_bt } from "./bt_store.js";
import { repair_misplaced_child_nodes, migrate_node_types } from "./bt_tree_repair.js";
import { NODE_REGISTRY } from "./nodes/registry.js";

/** @type {Map<string, { hash: number, root: object }>} */
const _cache = new Map();

function _tree_hash(tree) {
	return foundry.utils.hashCode(JSON.stringify(tree));
}

function _ensure_node_ids(node, path = "r") {
	if (!node?._id) node._id = path;
	const def = NODE_REGISTRY[node.type];
	if (node.children) {
		for (let i = 0; i < node.children.length; i++) {
			_ensure_node_ids(node.children[i], `${path}.${i}`);
		}
	}
	if (node.child && def?.category === "decorator") {
		_ensure_node_ids(node.child, `${path}.c`);
	}
}

/**
 * Return a prepared, read-only tree root for ticking.
 * @param {string} bt_id
 * @returns {object|null}
 */
export function get_prepared_root(bt_id) {
	const tree = get_bt(bt_id);
	if (!tree?.root) return null;

	const hash = _tree_hash(tree);
	const cached = _cache.get(bt_id);
	if (cached?.hash === hash) return cached.root;

	const root = foundry.utils.deepClone(tree.root);
	repair_misplaced_child_nodes(root);
	migrate_node_types(root);
	_ensure_node_ids(root);

	_cache.set(bt_id, { hash, root });
	return root;
}

/**
 * Return a prepared fragment root (without scope-specific ids).
 * @param {string} fragment_id
 * @returns {object|null}
 */
export function get_prepared_fragment_root(fragment_id) {
	return get_prepared_root(fragment_id);
}

/**
 * @param {string} [bt_id] — omit to clear all
 */
export function invalidate_tree_cache(bt_id) {
	if (bt_id) _cache.delete(bt_id);
	else _cache.clear();
}

/**
 * Clone a prepared root and assign scope-prefixed node ids for subtree ticks.
 * @param {object} prepared_root
 * @param {string} scope_prefix
 * @returns {object}
 */
export function clone_root_for_scope(prepared_root, scope_prefix) {
	const root = foundry.utils.deepClone(prepared_root);
	_ensure_node_ids(root, `${scope_prefix}r`);
	return root;
}

export { _ensure_node_ids as ensure_node_ids_for_engine };
