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
	const affected = Object.values(trees).filter((t) => t.folder === id);
	for (const tree of affected) {
		tree.folder = parent;
		await save_tree(tree); // per-key write; no monolith writes here
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
// Storage model (per-key): each tree/fragment lives in its own world
// setting "dialog_tree_<id>", with the id list tracked in "dialog_tree_ids".
// Writes ship one tree (~2–10 KB) instead of the whole store (100+ KB).
// The legacy monolithic "dialog_trees" blob is read as a fallback and
// drained by migrate_dialog_tree_store() — never written after migration.

const LEGACY_TREE_KEY = "dialog_trees";
const TREE_IDS_KEY = "dialog_tree_ids";
const TREE_KEY_PREFIX = "dialog_tree_";

function _tree_setting_key(id) {
	return `${TREE_KEY_PREFIX}${id}`;
}

/**
 * Migrate the legacy monolithic dialog_trees blob into per-tree settings.
 * Copies every tree to its own key, records ids in the index, then empties
 * the legacy blob (kept as {} so stale clients self-heal instead of
 * resurrecting the data). Idempotent: no legacy data → no-op.
 * @returns {Promise<{migrated: string[]}>}
 */
export async function migrate_dialog_tree_store() {
	const legacy = game.settings.get(MODULE_ID, LEGACY_TREE_KEY) || {};
	const raw = Array.isArray(legacy) ? legacy : Object.values(legacy);
	if (!raw.length) return { migrated: [] };
	const migrated = [];
	for (const tree of raw) {
		if (!tree?.id) continue;
		await game.settings.set(MODULE_ID, _tree_setting_key(tree.id), tree);
		migrated.push(tree.id);
	}
	const ids = new Set(game.settings.get(MODULE_ID, TREE_IDS_KEY) || []);
	for (const id of migrated) ids.add(id);
	await game.settings.set(MODULE_ID, TREE_IDS_KEY, [...ids]);
	// Empty the legacy blob; do NOT delete the setting registration.
	await game.settings.set(MODULE_ID, LEGACY_TREE_KEY, {});
	console.log(`[dc-npc-patrols] dialog tree store migration: ${migrated.length} trees moved to per-key storage`, migrated);
	return { migrated };
}

/**
 * Get all dialog trees as an object keyed by tree id.
 *
 * Merges per-key storage (index of ids → each tree's own setting) with any
 * legacy monolith data not yet migrated. Self-heals a legacy array-shaped
 * blob by re-keying entries by id. Read-only on the legacy blob — draining
 * it happens only in migrate_dialog_tree_store().
 *
 * @returns {Object<string, Object>}
 */
export function get_trees() {
	const merged = {};
	// Legacy blob first — per-key entries override after migration.
	const legacy = game.settings.get(MODULE_ID, LEGACY_TREE_KEY) || {};
	const legacy_list = Array.isArray(legacy) ? legacy : Object.values(legacy);
	for (const tree of legacy_list) {
		if (tree?.id) merged[tree.id] = tree;
	}
	// Per-key storage.
	const ids = game.settings.get(MODULE_ID, TREE_IDS_KEY) || [];
	for (const id of ids) {
		const tree = game.settings.get(MODULE_ID, _tree_setting_key(id));
		if (tree?.id) merged[tree.id] = tree;
	}
	return merged;
}

/**
 * Get a single tree by id.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_tree(id) {
	if (!id) return null;
	// Fast path: per-key storage.
	const ids = game.settings.get(MODULE_ID, TREE_IDS_KEY) || [];
	if (ids.includes(id)) {
		return game.settings.get(MODULE_ID, _tree_setting_key(id)) || null;
	}
	// Legacy fallback (pre-migration data).
	const legacy = game.settings.get(MODULE_ID, LEGACY_TREE_KEY) || {};
	const legacy_list = Array.isArray(legacy) ? legacy : Object.values(legacy);
	return legacy_list.find((t) => t?.id === id) || null;
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
	if (!tree.id) {
		tree.id = _generate_id("tree");
	}
	tree.kind = normalize_dialog_kind(tree.kind);
	// Per-key write: ship only this tree's JSON. Record the id in the index
	// first so readers that race the write still find the key registered.
	const ids = new Set(game.settings.get(MODULE_ID, TREE_IDS_KEY) || []);
	if (!ids.has(tree.id)) {
		ids.add(tree.id);
		await game.settings.set(MODULE_ID, TREE_IDS_KEY, [...ids]);
	}
	await game.settings.set(MODULE_ID, _tree_setting_key(tree.id), tree);
	return tree;
}

/**
 * Delete a tree by id.
 * @param {string} id
 */
export async function delete_tree(id) {
	const ids = new Set(game.settings.get(MODULE_ID, TREE_IDS_KEY) || []);
	if (ids.has(id)) {
		ids.delete(id);
		await game.settings.set(MODULE_ID, TREE_IDS_KEY, [...ids]);
	}
	await game.settings.set(MODULE_ID, _tree_setting_key(id), null);
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
		set_flags: "",
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
export function migrate_dialog_diverts(trees = get_trees()) {
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
	const trees = get_trees();
	const { changed, report } = migrate_dialog_diverts(trees);
	for (const id of changed) {
		if (trees[id]) await save_tree(trees[id]);
	}
	console.log(`[dc-npc-patrols] diverts migration: ${changed.length} trees migrated`, changed, report);
	return { changed, report };
}

// ── set_flags string migration ────────────────────────────────────

/**
 * Convert legacy map-shaped response.set_flags ({ key: value }) to the
 * plain-string format ("key, other=5"). Boolean-true values render as bare
 * tokens; everything else as "key=value" (value stringified). Idempotent:
 * string values pass through untouched. Empty maps become "".
 * @param {Object} [trees] — defaults to live settings; pass a clone to dry-run.
 * @returns {{changed: string[], report: Object[]}} changed tree ids + per-response report
 */
export function migrate_dialog_set_flags(trees = get_trees()) {
	const changed = [];
	const report = [];
	for (const tree of Object.values(trees)) {
		let tree_changed = false;
		for (const node of Object.values(tree.nodes || {})) {
			for (const r of node.responses || []) {
				if (!r.set_flags || typeof r.set_flags === "string") continue;
				r.set_flags = Object.entries(r.set_flags)
					.map(([k, v]) => (v === true ? k : `${k}=${v}`))
					.join(", ");
				tree_changed = true;
				report.push({ tree: tree.id, node: node.id, response: r.id, flags: r.set_flags });
			}
		}
		if (tree_changed) changed.push(tree.id);
	}
	return { changed, report };
}

/**
 * Run the set_flags migration against the live settings and persist.
 * @returns {Promise<{changed: string[], report: Object[]}>}
 */
export async function run_dialog_set_flags_migration() {
	assert_gm();
	const trees = get_trees();
	const { changed, report } = migrate_dialog_set_flags(trees);
	for (const id of changed) {
		if (trees[id]) await save_tree(trees[id]);
	}
	console.log(`[dc-npc-patrols] set_flags migration: ${changed.length} trees migrated`, changed, report);
	return { changed, report };
}

function assert_gm() {
	if (!game.user.isGM) throw new Error("dc-npc-patrols: GM required");
}
