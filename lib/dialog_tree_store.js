/**
 * dialog_tree_store.js — World-level CRUD for dialog trees and ambient line sets.
 *
 * Both collections are stored as JSON in module settings (world scope).
 * Trees are branching conversation graphs; ambient sets are simple
 * flavour-line collections. They are attached to individual actors by
 * reference (see attachment_editor.js).
 */

const MODULE_ID = "dc-npc-patrols";

// ── Dialog Trees ──────────────────────────────────────────────────

/**
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
 * Save (create or update) a tree. Generates an id if missing.
 * @param {Object} tree
 * @returns {Promise<Object>} the saved tree (with id)
 */
export async function save_tree(tree) {
	const trees = get_trees();
	if (!tree.id) {
		tree.id = _generate_id("tree");
	}
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
export function make_tree(name = "") {
	return {
		id: "",
		name,
		description: "",
		root_node: "start",
		nodes: {
			start: {
				id: "start",
				npc_text: "",
				responses: [],
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
		once: false,
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