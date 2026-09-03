/**
 * dialog_tree_store.js — World-level CRUD for dialog trees and ambient line sets.
 *
 * Both collections are stored as JSON in module settings (world scope).
 * Trees are branching conversation graphs; ambient sets are simple
 * flavour-line collections. They are attached to individual actors by
 * reference (see attachment_editor.js).
 */

import { normalize_dialog_kind, DT_KIND_TREE, DT_KIND_FRAGMENT } from "./dialog_kinds.js";

const MODULE_ID = "dc-npc-patrols";

// ── Dialog Folders ────────────────────────────────────────────────
/**
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
 * Delete a folder by id, reassigning its trees and sub-folders to the
 * deleted folder's parent ("" = root). Does not cascade-delete anything.
 * @param {string} id
 */
export async function delete_folder(id) {
	const folder = get_folder(id);
	const parent = folder?.parent || "";
	const trees = get_trees();
	let changed = false;
	for (const tree of Object.values(trees)) {
		if (tree.folder === id) {
			tree.folder = parent;
			changed = true;
		}
	}
	if (changed) {
		await game.settings.set(MODULE_ID, "dialog_trees", trees);
	}
	const folders = get_folders();
	// Promote any sub-folders to the deleted folder's parent.
	for (const f of Object.values(folders)) {
		if (f.id !== id && f.parent === id) {
			f.parent = parent;
		}
	}
	delete folders[id];
	await game.settings.set(MODULE_ID, "dialog_folders", folders);
}

/**
 * Create a new empty folder object (not yet saved).
 * @param {string} [name=""]
 * @param {string} [parent=""]
 * @returns {Object}
 */
export function make_folder(name = "", parent = "") {
	return { id: "", name, parent, sort: 0 };
}

// ── Dialog Trees ──────────────────────────────────────────────────

/**
 * Get all dialog trees as an object keyed by tree id.
 *
 * Self-heals a legacy/corrupted array-shaped setting (e.g. written as an
 * array by damaged module code): re-keys entries by their `id` and, when
 * the shape changed, persists the repaired object once. Read paths
 * (get_tree, list_*) and write paths (save_tree, delete_tree) both depend
 * on keyed-object semantics; a silently-unrepaired array would make
 * lookups miss and writes drop.
 * @returns {Object<string, Object>}
 */
export function get_trees() {
	const raw = game.settings.get(MODULE_ID, "dialog_trees") || {};
	if (!Array.isArray(raw)) return raw;
	const fixed = {};
	for (const tree of raw) {
		if (tree?.id) fixed[tree.id] = tree;
	}
	game.settings.set(MODULE_ID, "dialog_trees", fixed);
	return fixed;
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
export function make_tree(name = "") {
	return {
		id: "",
		name,
		description: "",
		kind: DT_KIND_TREE,
		folder: "",
		variables: [],
		root_node: "start",
		nodes: {
			start: {
				id: "start",
				npc_text: "",
				responses: [],
				diverts: [],
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
// ── Diverts migration ─────────────────────────────────────────────

/**
 * Migrate every dialog tree/fragment to per-row diverts: each divert
 * entry holds exactly ONE condition with its own goto (first-match-wins).
 *
 * Pass 1: legacy `flag_conditions` + `flag_conditions_else_goto` pair →
 *   one divert entry per condition (goto cloned to each).
 * Pass 2: multi-condition divert entries (old AND groups) → flattened,
 *   one condition per entry, goto cloned to each.
 *
 * Idempotent: single-condition diverts with no legacy pair are untouched.
 *
 * @param {Object} [trees] — defaults to live settings; pass a clone to dry-run.
 * @returns {{changed: string[], report: Object[]}} changed tree ids + per-node report
 */
export function migrate_dialog_diverts(trees = game.settings.get(MODULE_ID, "dialog_trees") || {}) {
	const changed = [];
	const report = [];
	for (const tree of Object.values(trees)) {
		let tree_changed = false;
		for (const node of Object.values(tree.nodes || {})) {
			const has_legacy = node?.flag_conditions_else_goto &&
				(node.flag_conditions?.length || node.flag_conditions_else_goto);
			if (has_legacy && !node.diverts?.length) {
				node.diverts = (node.flag_conditions?.length
					? node.flag_conditions
					: [{ flag_key: "", operator: "exists", expected_value: "", scope: "actor" }]
				).map((cond) => ({ conditions: [cond], goto: node.flag_conditions_else_goto }));
				delete node.flag_conditions;
				delete node.flag_conditions_else_goto;
				tree_changed = true;
				report.push({ tree: tree.id, node: node.id, diverts_to: node.diverts[0].goto });
			} else if (has_legacy && node.diverts?.length) {
				// Both present: legacy pair already superseded — strip it.
				delete node.flag_conditions;
				delete node.flag_conditions_else_goto;
				tree_changed = true;
				report.push({ tree: tree.id, node: node.id, dropped_legacy: true });
			}
			// Flatten legacy AND groups: one condition per divert entry.
			let flattened = 0;
			node.diverts = (node.diverts || []).flatMap((d) => {
				if (!d?.conditions?.length) return [d];
				if (d.conditions.length === 1) return [d];
				flattened += d.conditions.length;
				return d.conditions.map((cond) => ({ conditions: [cond], goto: d.goto ?? null }));
			});
			if (flattened) {
				tree_changed = true;
				report.push({ tree: tree.id, node: node.id, flattened });
			}
		}
		if (tree_changed) changed.push(tree.id);
	}
	return { changed, report };
}

/**
 * Run the diverts migration against the live settings and persist.
 * @returns {Promise<{changed: string[], report: Object[]}>}
 */
export async function run_dialog_diverts_migration() {
	assert_gm();
	const trees = foundry.utils.deepClone(game.settings.get(MODULE_ID, "dialog_trees") || {});
	const { changed, report } = migrate_dialog_diverts(trees);
	if (changed.length) {
		await game.settings.set(MODULE_ID, "dialog_trees", trees);
	}
	console.log(`[dc-npc-patrols] diverts migration: ${changed.length} trees migrated`, changed, report);
	return { changed, report };
}

function assert_gm() {
	if (!game.user.isGM) throw new Error("dc-npc-patrols: GM required");
}
