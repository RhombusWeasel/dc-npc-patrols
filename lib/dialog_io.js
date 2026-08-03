/**
 * dialog_io.js — Import/export helpers for dialog trees and ambient sets.
 *
 * Same pattern as bt_io.js: serialize to a tagged JSON envelope, parse on
 * import, and prepare the item for saving as a new world entry (de-duping
 * the name and regenerating the id so it doesn't collide).
 */

import { get_trees, get_ambient_sets } from "./dialog_tree_store.js";

const MODULE_ID = "dc-npc-patrols";
const DIALOG_FORMAT = "dc-npc-patrols-dialog-tree";
const AMBIENT_FORMAT = "dc-npc-patrols-ambient-set";
const FORMAT_VERSION = 1;

// ── Dialog Trees ──────────────────────────────────────────────────

/**
 * Serialize a dialog tree for export.
 * @param {Object} tree
 * @returns {string}
 */
export function serialize_dialog_export(tree) {
	const payload = {
		format: DIALOG_FORMAT,
		format_version: FORMAT_VERSION,
		module_version: game.modules.get(MODULE_ID)?.version ?? "unknown",
		exported_at: new Date().toISOString(),
		tree: foundry.utils.deepClone(tree),
	};
	return JSON.stringify(payload, null, 2);
}

/**
 * Parse imported JSON text into a dialog tree object.
 * @param {string} text
 * @returns {Object}
 * @throws {Error}
 */
export function parse_dialog_import(text) {
	const data = JSON.parse(text);
	if (data?.format === DIALOG_FORMAT && data.tree) {
		return data.tree;
	}
	// Also accept a bare tree object (nodes + root_node)
	if (data?.nodes && data?.root_node) {
		return data;
	}
	throw new Error("Unrecognised dialog tree format");
}

/**
 * Prepare an imported dialog tree for saving as a new world tree.
 * Strips the old id, de-dupes the name, and ensures required fields exist.
 * @param {Object} tree
 * @param {Object<string, Object>} existing_trees
 * @returns {Object}
 */
export function prepare_imported_dialog(tree, existing_trees) {
	const prepared = foundry.utils.deepClone(tree);
	delete prepared.id;

	const existing_names = new Set(
		Object.values(existing_trees).map((t) => (t.name || "").trim()).filter(Boolean)
	);
	let name = (prepared.name || "Imported Dialog").trim() || "Imported Dialog";
	if (existing_names.has(name)) {
		do {
			name = `${name} (Import)`;
		} while (existing_names.has(name));
	}
	prepared.name = name;
	prepared.description = prepared.description ?? "";
	prepared.root_node = prepared.root_node || Object.keys(prepared.nodes || {})[0] || "start";
	prepared.nodes = prepared.nodes || {};

	return prepared;
}

/**
 * Build a safe filename for a dialog tree export.
 * @param {Object} tree
 * @returns {string}
 */
export function dialog_export_filename(tree) {
	const slug = (tree.name || "dialog-tree")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "dialog-tree";
	return `${slug}-dialog-tree.json`;
}

// ── Ambient Sets ─────────────────────────────────────────────────

/**
 * Serialize an ambient set for export.
 * @param {Object} set
 * @returns {string}
 */
export function serialize_ambient_export(set) {
	const payload = {
		format: AMBIENT_FORMAT,
		format_version: FORMAT_VERSION,
		module_version: game.modules.get(MODULE_ID)?.version ?? "unknown",
		exported_at: new Date().toISOString(),
		set: foundry.utils.deepClone(set),
	};
	return JSON.stringify(payload, null, 2);
}

/**
 * Parse imported JSON text into an ambient set object.
 * @param {string} text
 * @returns {Object}
 * @throws {Error}
 */
export function parse_ambient_import(text) {
	const data = JSON.parse(text);
	if (data?.format === AMBIENT_FORMAT && data.set) {
		return data.set;
	}
	// Also accept a bare set object (name + lines)
	if (data?.lines && Array.isArray(data.lines)) {
		return data;
	}
	throw new Error("Unrecognised ambient set format");
}

/**
 * Prepare an imported ambient set for saving as a new world set.
 * @param {Object} set
 * @param {Object<string, Object>} existing_sets
 * @returns {Object}
 */
export function prepare_imported_ambient(set, existing_sets) {
	const prepared = foundry.utils.deepClone(set);
	delete prepared.id;

	const existing_names = new Set(
		Object.values(existing_sets).map((s) => (s.name || "").trim()).filter(Boolean)
	);
	let name = (prepared.name || "Imported Ambient Set").trim() || "Imported Ambient Set";
	if (existing_names.has(name)) {
		do {
			name = `${name} (Import)`;
		} while (existing_names.has(name));
	}
	prepared.name = name;
	prepared.lines = Array.isArray(prepared.lines) ? prepared.lines : [];

	return prepared;
}

/**
 * Build a safe filename for an ambient set export.
 * @param {Object} set
 * @returns {string}
 */
export function ambient_export_filename(set) {
	const slug = (set.name || "ambient-set")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "") || "ambient-set";
	return `${slug}-ambient-set.json`;
}

// ── Re-exports for convenience ────────────────────────────────────

export { get_trees, get_ambient_sets };