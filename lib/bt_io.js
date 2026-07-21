/**
 * bt_io.js — Import/export helpers for behaviour trees.
 */

import { NODE_REGISTRY, init_bt_nodes, get_variable_type_options } from "./nodes/loader.js";
import { normalize_bt_kind, BT_KIND_FRAGMENT, BT_KIND_TREE } from "./bt_kinds.js";
import { validate_subtree_links } from "./bt_subtree.js";
import { get_bts } from "./bt_store.js";

const MODULE_ID = "dc-npc-patrols";
const FORMAT = "dc-npc-patrols-behaviour-tree";
const FORMAT_VERSION = 1;

// Core nodes are registered by main.js via init_bt_nodes() before import/export runs.

function _variable_type_ids() {
	return get_variable_type_options().map((t) => t.id);
}

let _node_id_counter = 0;

function _gen_node_id() {
	return `n${++_node_id_counter}_${Date.now().toString(36).slice(-4)}`;
}

function _regenerate_node_ids(node) {
	if (!node) return;
	node._id = _gen_node_id();
	if (node._label === undefined) node._label = "";
	if (node.children) for (const c of node.children) _regenerate_node_ids(c);
	if (node.child) _regenerate_node_ids(node.child);
}

function _validate_node(node, path = "root") {
	if (!node || typeof node !== "object") {
		return `${path}: node must be an object`;
	}
	if (!node.type || !NODE_REGISTRY[node.type]) {
		return `${path}: unknown node type "${node.type ?? ""}"`;
	}

	const def = NODE_REGISTRY[node.type];
	if (def.category === "composite") {
		if (!Array.isArray(node.children)) {
			return `${path}: composite node must have a children array`;
		}
		for (let i = 0; i < node.children.length; i++) {
			const err = _validate_node(node.children[i], `${path}.children[${i}]`);
			if (err) return err;
		}
	} else if (def.category === "decorator") {
		if (node.child !== null && node.child !== undefined) {
			const err = _validate_node(node.child, `${path}.child`);
			if (err) return err;
		}
	} else if (def.category === "reference") {
		if (node.type === "subtree" && !node.bt_id) {
			return `${path}: subtree node must have bt_id`;
		}
	}

	return null;
}

function _validate_variables(variables) {
	if (!Array.isArray(variables)) {
		return "variables must be an array";
	}
	for (let i = 0; i < variables.length; i++) {
		const v = variables[i];
		if (!v || typeof v !== "object") {
			return `variables[${i}] must be an object`;
		}
		if (!v.key || typeof v.key !== "string") {
			return `variables[${i}] must have a key string`;
		}
		if (v.type && !_variable_type_ids().includes(v.type)) {
			return `variables[${i}] has unknown type "${v.type}"`;
		}
	}
	return null;
}

/**
 * Validate a behaviour tree object.
 * @param {Object} tree
 * @returns {string|null} error message or null if valid
 */
export function validate_bt_tree(tree) {
	if (!tree || typeof tree !== "object") {
		return "tree must be an object";
	}
	if (!tree.root) {
		return "tree must have a root node";
	}

	const kind = normalize_bt_kind(tree.kind);
	if (kind !== BT_KIND_TREE && kind !== BT_KIND_FRAGMENT) {
		return "tree kind must be \"tree\" or \"fragment\"";
	}

	const root_def = NODE_REGISTRY[tree.root.type];
	if (!root_def) {
		return "root node has unknown type";
	}
	if (kind === BT_KIND_TREE && root_def.category !== "composite") {
		return "root node must be a composite (selector, sequence, or parallel)";
	}

	const var_err = _validate_variables(tree.variables ?? []);
	if (var_err) return var_err;

	const node_err = _validate_node(tree.root);
	if (node_err) return node_err;

	const bts = get_bts();
	const validate_id = tree.id || "__validate__";
	const merged_bts = tree.id ? bts : { ...bts, [validate_id]: tree };
	const link_errors = validate_subtree_links(tree.root, validate_id, merged_bts);
	if (link_errors.length) return link_errors[0];

	return null;
}

/**
 * Serialize a tree for export.
 * @param {Object} tree
 * @returns {string}
 */
export function serialize_bt_export(tree) {
	const payload = {
		format: FORMAT,
		format_version: FORMAT_VERSION,
		module_version: game.modules.get(MODULE_ID)?.version ?? "unknown",
		exported_at: new Date().toISOString(),
		tree: foundry.utils.deepClone(tree),
	};
	return JSON.stringify(payload, null, 2);
}

/**
 * Parse imported JSON text into a tree object.
 * @param {string} text
 * @returns {Object}
 * @throws {Error}
 */
export function parse_bt_import(text) {
	const data = JSON.parse(text);
	if (data?.format === FORMAT && data.tree) {
		return data.tree;
	}
	if (data?.root) {
		return data;
	}
	throw new Error("Unrecognised behaviour tree format");
}

/**
 * Prepare an imported tree for saving as a new world tree.
 * @param {Object} tree
 * @param {Object<string, Object>} existing_bts
 * @returns {Object}
 */
export function prepare_imported_tree(tree, existing_bts) {
	const prepared = foundry.utils.deepClone(tree);
	delete prepared.id;

	const existing_names = new Set(
		Object.values(existing_bts).map((t) => (t.name || "").trim()).filter(Boolean)
	);
	let name = (prepared.name || "Imported Tree").trim() || "Imported Tree";
	if (existing_names.has(name)) {
		do {
			name = `${name} (Import)`;
		} while (existing_names.has(name));
	}
	prepared.name = name;
	prepared.description = prepared.description ?? "";
	prepared.variables = prepared.variables ?? [];
	prepared.kind = normalize_bt_kind(prepared.kind);

	_regenerate_node_ids(prepared.root);
	return prepared;
}

/**
 * Build a safe filename for export.
 * @param {Object} tree
 * @returns {string}
 */
export function export_filename(tree) {
	const slug = (tree.name || "behaviour-tree")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "behaviour-tree";
	return `${slug}-behaviour-tree.json`;
}
