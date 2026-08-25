/**
 * dialog_tree_store.js — World-level CRUD for dialog trees and ambient line sets.
 *
 * Both collections are stored as JSON in module settings (world scope).
 * Trees are branching conversation graphs; ambient sets are simple
 * flavour-line collections. They are attached to individual actors by
 * reference (see attachment_editor.js).
 */

import { normalize_dialog_kind, DT_KIND_TREE, DT_KIND_FRAGMENT } from "./dialog_kinds.js";

// ── Dialog Folders ────────────────────────────────────────────────
/**
 * Get all dialog folders keyed by folder id.
 * @returns {Object<string, Object>}
 */
export function get_folders() {

 * Get all dialog folders keyed by folder id.
 * @returns {Object<string, Object>}
 */
export function get_folders() {
	return game.settings.get(MODULE_ID, "dialog_folders") || {};
}

/**
 * Get a single dialog folder by id, or null if missing.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_folder(id) {
	const folders = get_folders();
	return folders[id] || null;
}

/**
 * Save (create or update) a dialog folder. Generates an id if missing.
 * @param {Object} folder
 * @returns {Promise<Object>} the saved folder (with id)
 */
export async function save_folder(folder) {
	const folders = get_folders();
	if (!folder.id) {
		folder.id = _generate_id("dfolder");
	}
	folders[folder.id] = folder;
	await game.settings.set(MODULE_ID, "dialog_folders", folders);
	return folder;
}

/**
 * Delete a folder by id, reassigning its trees/fragments to the root
 * ("Unfiled"). Does not cascade-delete the trees themselves.
 * @param {string} id
 */
export async function delete_folder(id) {
	const trees = get_trees();
	let changed = false;
	for (const tree of Object.values(trees)) {
		if (tree.folder === id) {
			tree.folder = "";
			changed = true;
		}
	}
	if (changed) {
		await game.settings.set(MODULE_ID, "dialog_trees", trees);
	}
	const folders = get_folders();
	delete folders[id];
	await game.settings.set(MODULE_ID, "dialog_folders", folders);
}

/**
 * Create a new empty folder object (not yet saved).
 * @param {string} [name=""]
 * @returns {Object}
 */
export function make_folder(name = "") {
	return { id: "", name, sort: 0 };
}

/**
 * Get all dialog trees as an object keyed by tree id.
 * @returns {Object<string, Object>}
 */
export function get_trees() {
 * Get all dialog trees as an object keyed by tree id.
 * @returns {Object<string, Object>}
 */
export function get_trees() {
	return game.settings.get(MODULE_ID, "dialog_trees") || {};
}

/**
 * Get a single tree by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_tree(id) {
	const trees = get_trees();
	return trees[id] || null;
}
/**
 * List all dialog trees (kind = tree).
 * @param {Object<string, Object>} [trees]
 * @returns {Object[]}
 */
export function list_dialog_trees(trees = get_trees()) {
	return Object.values(trees).filter((t) => normalize_dialog_kind(t.kind) === DT_KIND_TREE);
}

/**
 * List all dialog fragments (kind = fragment).
 * @param {Object<string, Object>} [trees]
 * @returns {Object[]}
 */
export function list_dialog_fragments(trees = get_trees()) {
	return Object.values(trees).filter((t) => normalize_dialog_kind(t.kind) === DT_KIND_FRAGMENT);
}

/**
 * Get a dialog fragment by id, or null if it isn't one.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_dialog_fragment(id) {
	const tree = get_tree(id);
	if (!tree) return null;
	return normalize_dialog_kind(tree.kind) === DT_KIND_FRAGMENT ? tree : null;
}

export async function save_tree(tree) {
	const trees = get_trees();
	if (!tree.id) {
		tree.id = _generate_id("tree");
	}
	tree.kind = normalize_dialog_kind(tree.kind);
	trees[tree.id] = tree;
	await game.settings.set(MODULE_ID, "dialog_trees", trees);
	return tree;
}

/**
 * Delete a tree by id.
 * @param {string} id
 */
export async function delete_tree(id) {
	const trees = get_trees();
	delete trees[id];
	await game.settings.set(MODULE_ID, "dialog_trees", trees);
}

/**
 * Create a new empty tree object (not yet saved).
 * @param {string} [name="New Tree"]
 * @returns {Object}
 */
		folder: "",
		variables: [],
		variables: [],
		root_node: "start",
		nodes: {
			start: {
				id: "start",
				npc_text: "",
				responses: [],
				flag_conditions: [],
				flag_conditions_else_goto: null,
			},
		},
	};
}

/**
 * Create a new empty response object.
 * @returns {Object}
 */
export function make_response() {
	return {
		id: `r_${Date.now()}`,
		text: "",
		goto: null,
		boons: [],
		set_flags: {},
		set_flags_scope: "actor",
		once: false,
		flag_conditions: [],
	};
}

// ── Ambient Line Sets ─────────────────────────────────────────────

/**
 * Get all ambient sets keyed by set id.
 * @returns {Object<string, Object>}
 */
export function get_ambient_sets() {
	return game.settings.get(MODULE_ID, "ambient_sets") || {};
}

/**
 * Get a single ambient set by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_ambient_set(id) {
	const sets = get_ambient_sets();
	return sets[id] || null;
}

/**
 * Save (create or update) an ambient set. Generates an id if missing.
 * @param {Object} set
 * @returns {Promise<Object>}
 */
export async function save_ambient_set(set) {
	const sets = get_ambient_sets();
	if (!set.id) {
		set.id = _generate_id("ambient");
	}
	sets[set.id] = set;
	await game.settings.set(MODULE_ID, "ambient_sets", sets);
	return set;
}

/**
 * Delete an ambient set by id.
 * @param {string} id
 */
export async function delete_ambient_set(id) {
	const sets = get_ambient_sets();
	delete sets[id];
	await game.settings.set(MODULE_ID, "ambient_sets", sets);
}

/**
 * Create a new empty ambient set (not yet saved).
 * @param {string} [name=""]
 * @returns {Object}
 */
export function make_ambient_set(name = "") {
	return {
		id: "",
		name,
		lines: [],
	};
}

// ── Helpers ───────────────────────────────────────────────────────

function _generate_id(prefix) {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}