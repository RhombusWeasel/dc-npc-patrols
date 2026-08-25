/**
 * dialog_fragments.js — Fragment library helpers for dialog trees.
 *
 * Dialog trees are flat node maps ({ id: node }) joined by `goto` edges,
 * unlike BT's nested composite tree. Two composition modes are supported,
 * mirroring bt_subtree.js:
 *
 *   Insert — deep-copy a fragment's nodes into a tree, regenerating node and
 *            response ids and remapping internal goto edges. The copy is
 *            independent of the source fragment.
 *
 *   Link   — a `dialog_ref` node (node.tree_id → fragment) is a live reference.
 *            At runtime, expand_dialog_tree() replaces the ref node with the
 *            fragment's nodes, scoped under the ref node id, and rewires the
 *            fragment's terminating (goto=null) responses to `return_to` the
 *            parent tree node the GM chose. Editing the fragment updates every
 *            linked tree immediately.
 *
 * Variable resolution: a tree (and each linked fragment) declares
 * `variables: [{ key, label, type, default }]`. Per-actor overrides live in the
 * `dialog_variables` actor flag. `{{key}}` placeholders in npc_text and
 * response text resolve against the merged defs — same pattern as BT template
 * variables. Linked-fragment variable keys are global (not namespaced), so a
 * shared fragment's `{{opinion_mayor}}` resolves against the same override
 * wherever it is linked.
 */

import { get_tree, get_dialog_fragment, get_trees } from "./dialog_tree_store.js";
import { normalize_dialog_kind } from "./dialog_kinds.js";
import { coerce_variable_value } from "./bt_variables.js";
import { build_variable_field } from "./nodes/variable_registry.js";

const MODULE_ID = "dc-npc-patrols";
const SCOPE_SEP = ":";

let _id_counter = 0;

function _gen_id(prefix) {
	return `${prefix}_${Date.now().toString(36)}_${(++_id_counter).toString(36)}_${foundry.utils.randomID().slice(0, 4)}`;
}

/**
 * True when a node is a live dialog_ref (node.tree_id points at a fragment).
 * @param {Object} node
 * @returns {boolean}
 */
export function is_dialog_ref(node) {
	return !!node && typeof node === "object" && !!node.tree_id;
}

/**
 * True when a tree (kind) is a fragment.
 * @param {Object} tree
 * @returns {boolean}
 */
export function is_fragment(tree) {
	return normalize_dialog_kind(tree?.kind) === "fragment";
}

// ── Insert (copy) ──────────────────────────────────────────────────

/**
 * Deep clone a fragment's nodes with fresh node + response ids and remapped
 * internal goto edges.
 * @param {Object} fragment — fragment tree
 * @returns {{ nodes: Object, root_node: string }|null}
 */
export function clone_dialog_subtree(fragment) {
	if (!fragment?.nodes) return null;
	const nodes = foundry.utils.deepClone(fragment.nodes);

	// Build old→new id map for nodes and responses.
	const node_remap = {};
	for (const id of Object.keys(nodes)) {
		node_remap[id] = _gen_id("node");
	}

	// Remap node ids AND the map keys so keys stay in sync with node.id.
	const remapped = {};
	for (const [id, node] of Object.entries(nodes)) {
		node.id = node_remap[id];
		for (const r of node.responses || []) {
			r.id = _gen_id("r");
		}
		remapped[node.id] = node;
	}

	// Rewrite internal goto edges (node-level + response-level).
	for (const node of Object.values(remapped)) {
		if (node.flag_conditions_else_goto && node_remap[node.flag_conditions_else_goto]) {
			node.flag_conditions_else_goto = node_remap[node.flag_conditions_else_goto];
		}
		for (const r of node.responses || []) {
			if (r.goto && node_remap[r.goto]) r.goto = node_remap[r.goto];
		}
	}

	return { nodes: remapped, root_node: node_remap[fragment.root_node || Object.keys(fragment.nodes)[0]] };
}

/**
 * Merge a deep-cloned fragment into a tree's node map (Insert mode).
 * Fragment variable defs are merged with a namespace prefix so repeated
 * inserts get independent keys.
 * @param {Object} tree — parent tree (mutated)
 * @param {Object} fragment — source fragment
 * @returns {{ root_node: string|null, added_nodes: string[] }}
 */
export function merge_dialog_fragment(tree, fragment) {
	const cloned = clone_dialog_subtree(fragment);
	if (!cloned) return { root_node: null, added_nodes: [] };

	const prefix = `f_${foundry.utils.randomID()}`;
	const added_nodes = [];
	for (const [id, node] of Object.entries(cloned.nodes)) {
		if (tree.nodes[id]) continue; // collision — skip
		tree.nodes[id] = node;
		added_nodes.push(id);
	}

	// Prefix {{var}} placeholders for the fragment's declared vars.
	const var_keys = new Set((fragment.variables || []).map((v) => v.key).filter(Boolean));
	for (const id of added_nodes) {
		const node = tree.nodes[id];
		node.npc_text = _prefix_text(node.npc_text, var_keys, prefix);
		for (const r of node.responses || []) {
			r.text = _prefix_text(r.text, var_keys, prefix);
		}
	}

	// Merge fragment variable defs (namespaced) into the tree.
	const merged_vars = (tree.variables || []).slice();
	const existing = new Set(merged_vars.map((v) => v.key).filter(Boolean));
	for (const v of fragment.variables || []) {
		if (!v?.key) continue;
		const new_key = `${prefix}_${v.key}`;
		if (existing.has(new_key)) continue;
		existing.add(new_key);
		merged_vars.push({ ...foundry.utils.deepClone(v), key: new_key });
	}
	tree.variables = merged_vars;

	return { root_node: cloned.root_node, added_nodes };
}

function _prefix_text(text, var_keys, prefix) {
	if (typeof text !== "string" || !var_keys.size || !text.includes("{{")) return text;
	return text.replace(/\{\{(\w+)\}\}/g, (m, key) =>
		var_keys.has(key) ? `{{${prefix}_${key}}}` : m
	);
}

/**
 * Infer variable defs referenced by a tree's {{key}} placeholders.
 * @param {Object} tree
 * @returns {Array}
 */
export function infer_dialog_variables(tree) {
	const refs = new Set();
	for (const node of Object.values(tree?.nodes || {})) {
		if (is_dialog_ref(node)) continue;
		_collect_placeholders(node.npc_text, refs);
		for (const r of node.responses || []) _collect_placeholders(r.text, refs);
	}
	const by_key = Object.fromEntries((tree?.variables || []).filter((v) => v.key).map((v) => [v.key, v]));
	const out = [];
	for (const key of refs) {
		if (by_key[key]) out.push(foundry.utils.deepClone(by_key[key]));
		else out.push({ key, label: key, type: "text", default: "" });
	}
	return out;
}

function _collect_placeholders(text, set) {
	if (typeof text !== "string" || !text.includes("{{")) return;
	for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) set.add(m[1]);
}

// ── Link (live) ────────────────────────────────────────────────────

/**
 * Expand a dialog tree into a runtime conversation map by replacing every
 * dialog_ref node with its linked fragment's nodes (scoped under the ref node
 * id). Returns a flat map of scoped node ids → nodes plus the resolved root.
 *
 * A linked fragment's terminating (goto=null) responses are wired to return to
 * the ref node's `return_to` parent node instead of closing the conversation.
 *
 * @param {Object} tree — root tree
 * @returns {{ nodes: Object, root_node: string }|null}
 */
export function expand_dialog_tree(tree) {
	if (!tree?.nodes) return null;
	const nodes = {};
	const visited = new Set();
	// ref alias: scoped ref id → scoped fragment-root id (a goto that targets
	// the ref node must enter the fragment at its root).
	const aliases = {};

	function scope(id, prefix) {
		return prefix ? `${prefix}${SCOPE_SEP}${id}` : id;
	}

	// Clone `source`'s nodes into `nodes` under `prefix`, rewiring gotos and
	// (for a linked fragment) terminal responses to `return_to`. Returns the
	// list of [scopedId, refNode] found in THIS source only.
	function add_nodes(source, prefix, return_to) {
		const refs = [];
		for (const [id, raw] of Object.entries(source.nodes || {})) {
			const node = foundry.utils.deepClone(raw);
			const sid = scope(id, prefix);
			if (node.flag_conditions_else_goto) {
				node.flag_conditions_else_goto = scope(node.flag_conditions_else_goto, prefix);
			}
			for (const r of node.responses || []) {
				if (r.goto) r.goto = scope(r.goto, prefix);
				else if (return_to) r._return_to = return_to;
			}
			nodes[sid] = node;
			if (is_dialog_ref(node) && !node._expanded) refs.push([sid, node]);
		}
		return refs;
	}

	// Expand `source` (a tree or fragment) whose nodes live under `prefix`.
	// `return_to` is the fully-scoped id to route terminal responses to (null
	// for the root tree → terminal responses close the conversation).
	function expand(source, prefix, return_to) {
		const refs = add_nodes(source, prefix, return_to);
		for (const [sid, node] of refs) {
			node._expanded = true;
			// The ref's return_to is a node id in its containing tree (this
			// source), which lives under `prefix`.
			const ref_return = node.return_to ? scope(node.return_to, prefix) : null;
			const fragment = get_dialog_fragment(node.tree_id);
			if (!fragment) {
				node.npc_text = node.npc_text || "⚠ Fragment missing.";
				node.responses = [];
				node.tree_id = null;
				continue;
			}
			if (visited.has(fragment.id)) {
				node.npc_text = node.npc_text || "⚠ Circular fragment reference.";
				node.responses = [];
				node.tree_id = null;
				continue;
			}
			visited.add(fragment.id);
			// Fragment nodes live under the ref node's scoped id. The fragment
			// root takes over the ref node's position, so gotos targeting the
			// ref must enter the fragment at its root.
			const frag_root_raw = fragment.root_node || Object.keys(fragment.nodes || {})[0];
			aliases[sid] = scope(frag_root_raw, sid);
			expand(fragment, sid, ref_return);
			visited.delete(fragment.id);
		}
	}

	expand(tree, "", null);

	// Redirect any goto/else_goto that targeted a ref node to the fragment root.
	for (const node of Object.values(nodes)) {
		if (node.flag_conditions_else_goto && aliases[node.flag_conditions_else_goto]) {
			node.flag_conditions_else_goto = aliases[node.flag_conditions_else_goto];
		}
		for (const r of node.responses || []) {
			if (r.goto && aliases[r.goto]) r.goto = aliases[r.goto];
		}
	}
	// Ref node shells no longer needed.
	for (const sid of Object.keys(aliases)) delete nodes[sid];

	return {
		nodes,
		root_node: scope(tree.root_node || Object.keys(tree.nodes || {})[0], ""),
	};
}

/**
 * Collect variable defs for a tree and all linked fragments (parent first).
 * Linked-fragment defs are collected UN-NAMESPACED: a fragment's own keys are
 * global, so `{{opinion_mayor}}` in any linked fragment resolves against the
 * same per-actor override. This is the intended model for shared fragments
 * (e.g. "opinions around town" linked to many actors).
 * @param {string} tree_id
 * @param {Object} [trees]
 * @param {Set<string>} [visiting]
 * @returns {Array}
 */
export function collect_dialog_variable_defs(tree_id, trees = undefined, visiting = new Set()) {
	if (!tree_id || visiting.has(tree_id)) return [];
	visiting.add(tree_id);
	const tree = trees ? trees[tree_id] : get_tree(tree_id);
	if (!tree) {
		visiting.delete(tree_id);
		return [];
	}
	const result = [];
	const seen = new Set();
	function add_defs(defs) {
		for (const d of defs || []) {
			const key = d?.key;
			if (!key || seen.has(key)) continue;
			seen.add(key);
			result.push(foundry.utils.deepClone(d));
		}
	}
	add_defs(tree.variables);
	for (const node of Object.values(tree.nodes || {})) {
		if (is_dialog_ref(node) && node.tree_id) {
			add_defs(collect_dialog_variable_defs(node.tree_id, trees, visiting));
		}
	}
	visiting.delete(tree_id);
	return result;
}

/**
 * Resolve a tree's variables (including linked fragments) against an actor's
 * dialog_variables overrides. Returns { key: value } for {{key}} substitution.
 * @param {Actor} actor
 * @param {Object} tree
 * @returns {Object}
 */
export function resolve_dialog_variables(actor, tree) {
	const overrides = actor?.getFlag(MODULE_ID, "dialog_variables") || {};
	const defs = tree?.id ? collect_dialog_variable_defs(tree.id) : (tree?.variables || []);
	const resolved = {};
	for (const def of defs) {
		const key = def.key;
		if (!key) continue;
		const raw = overrides[key];
		const has = raw !== undefined && raw !== "";
		resolved[key] = coerce_variable_value(has ? raw : (def.default ?? ""), def.type || "text", def.default ?? "");
	}
	return resolved;
}

/**
 * Build per-actor variable field objects for a tree's dialog_variables UI.
 * Mirrors build_variable_fields in bt_variables.js for the hub override editor.
 * @param {Actor} actor
 * @param {Object} tree
 * @returns {Array}
 */
export function build_dialog_variable_fields(actor, tree) {
	const defs = tree?.id ? collect_dialog_variable_defs(tree.id) : (tree?.variables || []);
	if (!defs.length) return [];
	const actor_vars = actor?.getFlag(MODULE_ID, "dialog_variables") || {};
	return defs.filter((d) => d.key).map((def) => {
		const raw = actor_vars[def.key];
		const has_value = raw !== undefined && raw !== "";
		return build_variable_field(def, raw, has_value, {});
	});
}

/**
 * Detect whether a tree's dialog_ref graph contains a cycle.
 * @param {string} tree_id
 * @param {Object} [trees]
 * @returns {boolean}
 */
export function detect_dialog_cycles(tree_id, trees = undefined) {
	const source = trees || get_trees();
	const visiting = new Set();
	const visited = new Set();
	function walk(id) {
		if (!id || visited.has(id)) return false;
		const t = source[id];
		if (!t) return false;
		if (visiting.has(id)) return true;
		visiting.add(id);
		for (const node of Object.values(t.nodes || {})) {
			if (is_dialog_ref(node) && node.tree_id) {
				if (walk(node.tree_id)) {
					visiting.delete(id);
					return true;
				}
			}
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	}
	return walk(tree_id);
}

/**
 * Create a new dialog_ref node.
 * @param {string} tree_id — linked fragment id
 * @returns {Object}
 */
export function make_dialog_ref(tree_id) {
	return {
		id: _gen_id("node"),
		tree_id,
		return_to: null,
		npc_text: "",
		responses: [],
		flag_conditions: [],
		flag_conditions_else_goto: null,
	};
}
