/**
 * attachment_editor.js — NPC attachment manager for dialog trees and
 * ambient line sets.
 *
 * Shown as a section in the patrol manager panel (when an actor is
 * selected). Lists the actor's dialog + ambient attachments, and
 * provides add/remove controls.
 *
 * When an attachment is added, a proximity region is auto-created on
 * the current scene around the actor's token. When removed, the region
 * is deleted.
 */

import { get_trees, get_ambient_sets } from "./dialog_tree_store.js";
import { is_in_time_window } from "./time_gate.js";

const MODULE_ID = "dc-npc-patrols";

// ── Reusable attachment functions (shared by UI + BT nodes) ───────

/**
 * Add a dialog or ambient attachment to an actor, creating the proximity
 * region on the current scene.
 *
 * @param {Actor} actor
 * @param {"dialog"|"ambient"} kind
 * @param {Object} config — { tree_id or set_id, time_start, time_end, region_radius }
 * @param {RegionManager} region_manager
 * @returns {Promise<Object|null>} the saved attachment, or null on failure
 */
export async function add_attachment(actor, kind, config, region_manager) {
	const scene = canvas.scene;
	if (!scene) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.attachment.no_scene"));
		return null;
	}

	const token_doc = scene.tokens.find((t) => t.actor?.id === actor.id);
	if (!token_doc) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.panel.no_token_on_scene"));
		return null;
	}

	const attachment = {
		time_start: config.time_start || null,
		time_end: config.time_end || null,
		region_radius: config.region_radius || game.settings.get(MODULE_ID, "proximity_radius"),
		region_uuid: null,
	};

	if (kind === "dialog") {
		attachment.tree_id = config.tree_id;
		attachment.region_uuid = await region_manager.create_dialog_region(
			scene, token_doc, config.tree_id, actor.id, attachment.region_radius
		);
	} else {
		attachment.set_id = config.set_id;
		attachment.region_uuid = await region_manager.create_ambient_region(
			scene, token_doc, config.set_id, actor.id, attachment.region_radius
		);
	}

	const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
	const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, flag_key) || []);
	list.push(attachment);
	await actor.setFlag(MODULE_ID, flag_key, list);

	return attachment;
}

/**
 * Remove all attachments of the given kind from an actor, deleting their
 * proximity regions.
 *
 * @param {Actor} actor
 * @param {"dialog"|"ambient"} kind
 * @param {RegionManager} region_manager
 * @returns {Promise<number>} count removed
 */
export async function remove_all_attachments(actor, kind, region_manager) {
	const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
	const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, flag_key) || []);
	if (!list.length) return 0;

	const scene = canvas.scene;
	for (const att of list) {
		if (att.region_uuid) {
			await region_manager.delete_region(scene, att.region_uuid);
		}
	}

	await actor.setFlag(MODULE_ID, flag_key, []);
	return list.length;
}

/**
 * Replace all attachments of the given kind with a single new one.
 * Convenience: remove_all + add.
 *
 * @param {Actor} actor
 * @param {"dialog"|"ambient"} kind
 * @param {Object} config — same as add_attachment
 * @param {RegionManager} region_manager
 * @returns {Promise<Object|null>} the new attachment, or null on failure
 */
export async function replace_attachments(actor, kind, config, region_manager) {
	await remove_all_attachments(actor, kind, region_manager);
	return add_attachment(actor, kind, config, region_manager);
}

/**
 * Prepare attachment data for the template context.
 * Called by PatrolManagerPanel._prepareContext when rendering the
 * attachment tab.
 *
 * @param {Actor|null} selected_actor
 * @returns {Promise<Object>}
 */
export async function prepare_attachment_context(selected_actor) {
	if (!selected_actor) {
		return { selected_actor: null };
	}

	const dialog_attachments = foundry.utils.duplicate(
		selected_actor.getFlag(MODULE_ID, "dialog_attachments") || []
	);
	const ambient_attachments = foundry.utils.duplicate(
		selected_actor.getFlag(MODULE_ID, "ambient_attachments") || []
	);

	// Resolve tree/set names for display
	const trees = get_trees();
	for (const att of dialog_attachments) {
		att.tree_name = trees[att.tree_id]?.name || att.tree_id;
		// Keep time display clean: null → "always"
		att.time_start = att.time_start || "--:--";
		att.time_end = att.time_end || "--:--";
	}

	const sets = get_ambient_sets();
	for (const att of ambient_attachments) {
		att.set_name = sets[att.set_id]?.name || att.set_id;
		att.time_start = att.time_start || "--:--";
		att.time_end = att.time_end || "--:--";
	}

	return {
		selected_actor,
		dialog_attachments,
		ambient_attachments,
		available_trees: Object.values(trees).map((t) => ({ id: t.id, name: t.name })),
		available_sets: Object.values(sets).map((s) => ({ id: s.id, name: s.name })),
	};
}

/**
 * Wire up event handlers for the attachment editor section.
 * Called by PatrolManagerPanel._onRender.
 *
 * @param {HTMLElement} html — the panel element
 * @param {Actor|null} selected_actor
 * @param {RegionManager} region_manager
 */
export function wire_attachment_events(html, selected_actor, region_manager, on_change) {
	if (!selected_actor) return;

	// Add dialog attachment
	html.querySelector("[data-action='add-dialog-attachment']")?.addEventListener("click", async () => {
		const tree_id = html.querySelector("[data-add-dialog-tree]")?.value;
		if (!tree_id) return;
		const time_start = html.querySelector("[data-add-dialog-start]")?.value || null;
		const time_end = html.querySelector("[data-add-dialog-end]")?.value || null;
		const radius = parseInt(html.querySelector("[data-add-dialog-radius]")?.value, 10) ||
			game.settings.get(MODULE_ID, "proximity_radius");

		const result = await add_attachment(selected_actor, "dialog", {
			tree_id,
			time_start,
			time_end,
			region_radius: radius,
		}, region_manager);
		if (result) {
			ui.notifications.info(game.i18n.localize("dc-npc-patrols.attachment.added"));
			on_change?.();
		}
	});

	// Remove dialog attachment
	html.querySelectorAll("[data-remove-dialog]").forEach((el) => {
		el.addEventListener("click", async () => {
			const idx = parseInt(el.dataset.removeDialog, 10);
			const ok = await _remove_attachment_by_index(selected_actor, "dialog", idx, region_manager);
			if (ok) {
				ui.notifications.info(game.i18n.localize("dc-npc-patrols.attachment.removed"));
				on_change?.();
		}
		});
	});

	// Add ambient attachment
	html.querySelector("[data-action='add-ambient-attachment']")?.addEventListener("click", async () => {
		const set_id = html.querySelector("[data-add-ambient-set]")?.value;
		if (!set_id) return;
		const time_start = html.querySelector("[data-add-ambient-start]")?.value || null;
		const time_end = html.querySelector("[data-add-ambient-end]")?.value || null;
		const radius = parseInt(html.querySelector("[data-add-ambient-radius]")?.value, 10) ||
			game.settings.get(MODULE_ID, "proximity_radius");

		const result = await add_attachment(selected_actor, "ambient", {
			set_id,
			time_start,
			time_end,
			region_radius: radius,
		}, region_manager);
		if (result) {
			ui.notifications.info(game.i18n.localize("dc-npc-patrols.attachment.added"));
			on_change?.();
		}
	});

	// Remove ambient attachment
	html.querySelectorAll("[data-remove-ambient]").forEach((el) => {
		el.addEventListener("click", async () => {
			const idx = parseInt(el.dataset.removeAmbient, 10);
			const ok = await _remove_attachment_by_index(selected_actor, "ambient", idx, region_manager);
			if (ok) {
				ui.notifications.info(game.i18n.localize("dc-npc-patrols.attachment.removed"));
				on_change?.();
		}
		});
	});
}

// ── Internal helpers (UI-specific, not exported) ─────────────────

async function _remove_attachment_by_index(actor, kind, idx, region_manager) {
	const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
	const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, flag_key) || []);
	const attachment = list[idx];
	if (!attachment) return false;

	if (attachment.region_uuid) {
		await region_manager.delete_region(canvas.scene, attachment.region_uuid);
	}

	list.splice(idx, 1);
	await actor.setFlag(MODULE_ID, flag_key, list);
	return true;
}

/**
 * True when the actor has exactly one attachment of the given kind with the
 * matching id field value (used to skip no-op set_dialog replacements).
 * @param {Actor} actor
 * @param {"dialog"|"ambient"} kind
 * @param {"tree_id"|"set_id"} id_field
 * @param {string} id_value
 * @returns {boolean}
 */
export function has_sole_attachment(actor, kind, id_field, id_value) {
	const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
	const list = actor.getFlag(MODULE_ID, flag_key) || [];
	return list.length === 1 && list[0][id_field] === id_value;
}

/**
 * Find the attachment for a given actor + tree_id (used by the dcDialogTree
 * behavior to look up the time window).
 * @param {Actor} actor
 * @param {string} tree_id
 * @returns {Object|null}
 */
export function find_dialog_attachment(actor, tree_id) {
	const list = actor.getFlag(MODULE_ID, "dialog_attachments") || [];
	return list.find((a) => a.tree_id === tree_id) || null;
}

/**
 * Find the attachment for a given actor + set_id (used by the dcAmbient
 * behavior to look up the time window + cooldown).
 * @param {Actor} actor
 * @param {string} set_id
 * @returns {Object|null}
 */
export function find_ambient_attachment(actor, set_id) {
	const list = actor.getFlag(MODULE_ID, "ambient_attachments") || [];
	return list.find((a) => a.set_id === set_id) || null;
}

// Re-export for use by behavior types
export { is_in_time_window };