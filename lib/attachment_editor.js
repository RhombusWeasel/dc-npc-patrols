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

		await _add_attachment(selected_actor, "dialog", {
			tree_id,
			time_start,
			time_end,
			region_radius: radius,
			region_uuid: null,
		}, region_manager, on_change);
	});

	// Remove dialog attachment
	html.querySelectorAll("[data-remove-dialog]").forEach((el) => {
		el.addEventListener("click", async () => {
			const idx = parseInt(el.dataset.removeDialog, 10);
			await _remove_attachment(selected_actor, "dialog", idx, region_manager, on_change);
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

		await _add_attachment(selected_actor, "ambient", {
			set_id,
			time_start,
			time_end,
			region_radius: radius,
			region_uuid: null,
		}, region_manager, on_change);
	});

	// Remove ambient attachment
	html.querySelectorAll("[data-remove-ambient]").forEach((el) => {
		el.addEventListener("click", async () => {
			const idx = parseInt(el.dataset.removeAmbient, 10);
			await _remove_attachment(selected_actor, "ambient", idx, region_manager, on_change);
		});
	});
}

// ── Internal helpers ──────────────────────────────────────────────

async function _add_attachment(actor, kind, attachment, region_manager, on_change) {
	const scene = canvas.scene;
	if (!scene) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.attachment.no_scene"));
		return;
	}

	const token_doc = scene.tokens.find((t) => t.actor?.id === actor.id);
	if (!token_doc) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.panel.no_token_on_scene"));
		return;
	}

	// Create the proximity region
	let region_uuid = null;
	if (kind === "dialog") {
		region_uuid = await region_manager.create_dialog_region(
			scene, token_doc, attachment.tree_id, actor.id, attachment.region_radius
		);
	} else {
		region_uuid = await region_manager.create_ambient_region(
			scene, token_doc, attachment.set_id, actor.id, attachment.region_radius
		);
	}
	attachment.region_uuid = region_uuid;

	// Save attachment on actor
	const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
	const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, flag_key) || []);
	list.push(attachment);
	await actor.setFlag(MODULE_ID, flag_key, list);

	ui.notifications.info(game.i18n.localize("dc-npc-patrols.attachment.added"));
	on_change?.();
}

async function _remove_attachment(actor, kind, idx, region_manager, on_change) {
	const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
	const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, flag_key) || []);
	const attachment = list[idx];
	if (!attachment) return;

	// Delete the region
	if (attachment.region_uuid) {
		await region_manager.delete_region(canvas.scene, attachment.region_uuid);
	}

	list.splice(idx, 1);
	await actor.setFlag(MODULE_ID, flag_key, list);

	ui.notifications.info(game.i18n.localize("dc-npc-patrols.attachment.removed"));
	on_change?.();
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