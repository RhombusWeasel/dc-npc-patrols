/**
 * bt_store.js — World-level CRUD for behaviour trees.
 *
 * Stored as JSON in module settings (world scope), following the same
 * pattern as dialog_tree_store.js. NPCs attach to BTs via actor flag
 * `bt_id` (same pattern as dialog tree attachments).
 */

import { normalize_bt_kind, BT_KIND_TREE } from "./bt_kinds.js";

const MODULE_ID = "dc-npc-patrols";

/**
 * Get all behaviour trees as an object keyed by tree id.
 * @returns {Object<string, Object>}
 */
export function get_bts() {
	return game.settings.get(MODULE_ID, "behaviour_trees") || {};
}

/**
 * Get a single behaviour tree by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_bt(id) {
	const bts = get_bts();
	return bts[id] || null;
}

/**
 * Save (create or update) a behaviour tree. Generates an id if missing.
 * @param {Object} tree
 * @returns {Promise<Object>} the saved tree (with id)
 */
export async function save_bt(tree) {
	const bts = get_bts();
	if (!tree.id) {
		tree.id = _generate_id("bt");
	}
	tree.kind = normalize_bt_kind(tree.kind);
	bts[tree.id] = tree;
	await game.settings.set(MODULE_ID, "behaviour_trees", bts);
	return tree;
}

/**
 * Delete a behaviour tree by id.
 * @param {string} id
 */
export async function delete_bt(id) {
	const bts = get_bts();
	delete bts[id];
	await game.settings.set(MODULE_ID, "behaviour_trees", bts);
}

/**
 * Create a new empty behaviour tree object (not yet saved).
 * @param {string} [name=""]
 * @returns {Object}
 */
export function make_bt(name = "", kind = BT_KIND_TREE) {
	return {
		id: "",
		name,
		description: "",
		kind: normalize_bt_kind(kind),
		variables: [],
		root: {
			type: "selector",
			children: [],
		},
	};
}

// ── Helpers ───────────────────────────────────────────────────────

function _generate_id(prefix) {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}