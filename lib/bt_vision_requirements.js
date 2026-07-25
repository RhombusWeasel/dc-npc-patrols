/**
 * bt_vision_requirements.js — Detect whether a behaviour tree needs token vision.
 */

import { get_bts, get_bt } from "./bt_store.js";
import { get_node_def } from "./nodes/registry.js";

const VISION_NODE_TYPES = new Set([
	"action_update_visible_tokens",
	"condition_visible_tokens",
]);

function _node_requires_vision(node) {
	if (!node?.type) return false;
	if (node.type === "action_update_visible_tokens") return true;
	if (node.type === "condition_visible_tokens") {
		return node.refresh === true || node.refresh === "true";
	}
	return false;
}

function _walk_nodes(node, on_node) {
	if (!node) return;
	on_node(node);
	if (node.children) {
		for (const child of node.children) _walk_nodes(child, on_node);
	}
	if (node.child) _walk_nodes(node.child, on_node);
}

function _collect_vision_nodes(root, results = []) {
	_walk_nodes(root, (node) => {
		if (_node_requires_vision(node)) results.push(node);
	});
	return results;
}

function _collect_subtree_ids(root, ids = []) {
	_walk_nodes(root, (node) => {
		if (node.type === "subtree" && node.bt_id) ids.push(node.bt_id);
	});
	return ids;
}

function _node_label(node) {
	const def = get_node_def(node.type);
	return def?.label || node.type;
}

/**
 * Analyze whether a behaviour tree (and linked fragments) requires token vision.
 * @param {string} bt_id
 * @param {Object} [bts]
 * @returns {{ requires_vision: boolean, node_count: number, node_labels: string[] }}
 */
export function analyze_bt_vision_requirements(bt_id, bts = get_bts()) {
	const empty = { requires_vision: false, node_count: 0, node_labels: [] };
	if (!bt_id) return empty;

	const visited = new Set();
	const vision_nodes = [];
	const queue = [bt_id];

	while (queue.length) {
		const id = queue.shift();
		if (!id || visited.has(id)) continue;
		visited.add(id);

		const tree = bts[id] ?? get_bt(id);
		if (!tree?.root) continue;

		vision_nodes.push(..._collect_vision_nodes(tree.root));
		for (const ref_id of _collect_subtree_ids(tree.root)) {
			if (!visited.has(ref_id)) queue.push(ref_id);
		}
	}

	const node_labels = [...new Set(vision_nodes.map(_node_label))];

	return {
		requires_vision: vision_nodes.length > 0,
		node_count: vision_nodes.length,
		node_labels,
	};
}

/**
 * Enable token vision on a token document, using prototype range when needed.
 * @param {TokenDocument} token_doc
 * @returns {Promise<void>}
 */
export async function enable_token_vision(token_doc) {
	if (!token_doc) return;

	const current_range = Number(token_doc.sight?.range) || 0;
	const proto_range = Number(token_doc.actor?.prototypeToken?.sight?.range) || 0;
	const range = current_range > 0 ? current_range : (proto_range > 0 ? proto_range : 60);

	await token_doc.update({
		sight: {
			enabled: true,
			range,
		},
	});
}
