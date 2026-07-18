/**
 * bt_subtree.js — Fragment library helpers for behaviour tree composition.
 */

import { get_bts } from "./bt_store.js";
import { normalize_bt_kind, BT_KIND_TREE, BT_KIND_FRAGMENT } from "./bt_kinds.js";

export { BT_KIND_TREE, BT_KIND_FRAGMENT, normalize_bt_kind } from "./bt_kinds.js";

let _node_id_counter = 0;

function _gen_node_id() {
	return `n${++_node_id_counter}_${Date.now().toString(36).slice(-4)}`;
}

function _regenerate_node_ids(node, source_fragment_id = null) {
	if (!node) return;
	node._id = _gen_node_id();
	if (node._label === undefined) node._label = "";
	if (source_fragment_id) node._source_fragment_id = source_fragment_id;
	if (node.children) {
		for (const c of node.children) _regenerate_node_ids(c, source_fragment_id);
	}
	if (node.child) _regenerate_node_ids(node.child, source_fragment_id);
}

function _find_node(root, id, parent = null, key = null) {
	if (!root) return null;
	if (root._id === id) return { node: root, parent, key };
	if (root.children) {
		for (let i = 0; i < root.children.length; i++) {
			const result = _find_node(root.children[i], id, root, i);
			if (result) return result;
		}
	}
	if (root.child) {
		const result = _find_node(root.child, id, root, "child");
		if (result) return result;
	}
	return null;
}

function _collect_var_refs(node, keys = new Set()) {
	if (!node || typeof node !== "object") return keys;
	for (const [k, v] of Object.entries(node)) {
		if (k === "_id" || k === "type" || k === "children" || k === "child") continue;
		if (typeof v === "string") {
			for (const m of v.matchAll(/\{\{(\w+)\}\}/g)) keys.add(m[1]);
		}
	}
	if (node.children) for (const c of node.children) _collect_var_refs(c, keys);
	if (node.child) _collect_var_refs(node.child, keys);
	return keys;
}

export function list_trees(bts = get_bts()) {
	return Object.values(bts).filter((t) => normalize_bt_kind(t.kind) === BT_KIND_TREE);
}

export function list_fragments(bts = get_bts()) {
	return Object.values(bts).filter((t) => normalize_bt_kind(t.kind) === BT_KIND_FRAGMENT);
}

/**
 * Deep clone a node subtree with fresh _id values.
 * @param {Object} root
 * @param {string} [source_fragment_id]
 * @returns {Object}
 */
export function clone_subtree(root, source_fragment_id = null) {
	if (!root) return null;
	const clone = foundry.utils.deepClone(root);
	_regenerate_node_ids(clone, source_fragment_id);
	return clone;
}

/**
 * Clone the node at node_id from a tree root.
 * @param {Object} root
 * @param {string} node_id
 * @returns {Object|null}
 */
export function extract_selection(root, node_id) {
	const found = _find_node(root, node_id);
	if (!found?.node) return null;
	return foundry.utils.deepClone(found.node);
}

/**
 * Merge fragment variables into a parent tree's variable list.
 * @param {Array} parent_vars
 * @param {Array} fragment_vars
 * @returns {{ merged: Array, conflicts: string[] }}
 */
export function merge_variables(parent_vars = [], fragment_vars = []) {
	const merged = foundry.utils.deepClone(parent_vars);
	const keys = new Set(merged.map((v) => v.key).filter(Boolean));
	const conflicts = [];

	for (const frag_var of fragment_vars) {
		const key = frag_var?.key;
		if (!key) continue;
		if (keys.has(key)) {
			conflicts.push(key);
			continue;
		}
		keys.add(key);
		merged.push(foundry.utils.deepClone(frag_var));
	}

	return { merged, conflicts };
}

/**
 * Infer variable defs used by a node subtree from {{key}} placeholders.
 * @param {Object} root_node
 * @param {Array} source_variables
 * @returns {Array}
 */
export function infer_variables_for_node(root_node, source_variables = []) {
	const refs = _collect_var_refs(root_node);
	const by_key = Object.fromEntries(
		source_variables.filter((v) => v.key).map((v) => [v.key, v])
	);
	const inferred = [];
	for (const key of refs) {
		if (by_key[key]) inferred.push(foundry.utils.deepClone(by_key[key]));
		else inferred.push({ key, label: key, type: "text", default: "" });
	}
	return inferred;
}

/**
 * Walk a tree for live subtree reference nodes (Phase 2).
 * @param {Object} node
 * @param {string[]} refs
 * @returns {string[]}
 */
export function find_subtree_references(node, refs = []) {
	if (!node) return refs;
	if (node.type === "subtree" && node.bt_id) refs.push(node.bt_id);
	if (node.children) for (const c of node.children) find_subtree_references(c, refs);
	if (node.child) find_subtree_references(node.child, refs);
	return refs;
}

/**
 * Detect circular subtree references (Phase 2).
 * @param {string} bt_id
 * @param {Object} [bts]
 * @returns {boolean}
 */
export function detect_cycles(bt_id, bts = get_bts()) {
	const visiting = new Set();

	function walk(id) {
		if (visiting.has(id)) return true;
		const tree = bts[id];
		if (!tree?.root) return false;
		visiting.add(id);
		for (const ref_id of find_subtree_references(tree.root)) {
			if (walk(ref_id)) return true;
		}
		visiting.delete(id);
		return false;
	}

	return walk(bt_id);
}
