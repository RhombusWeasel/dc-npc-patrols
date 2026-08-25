/**
 * actor_dialog_tab.js — Dialog tab for Deadlands actor sheets.
 *
 * Editable per-NPC dialog_variables overrides for all dialog trees attached
 * to the actor. Mirrors the Behaviour tab pattern (actor_behaviour_tab.js)
 * and reuses the hub's dialog-variable field build + wiring logic.
 */

import { get_trees as get_dialog_trees } from "./dialog_tree_store.js";
import { build_dialog_variable_fields } from "./dialog_fragments.js";
import { resolve_actor_for_flags } from "./bt_variables.js";

const MODULE_ID = "dc-npc-patrols";

/** Tab panel div — not the nav link (both share data-tab). */
function _dialog_tab_root(html) {
	if (!html?.querySelector) return html;
	return html.querySelector('div.tab[data-tab="patrol_dialog"]')
		?? html.querySelector(".dc-patrol-dialog-tab")?.closest(".tab")
		?? html;
}

export async function prepare_dialog_tab_context(actor) {
	const attachments = actor.getFlag(MODULE_ID, "dialog_attachments") || [];
	const trees = get_dialog_trees();

	const tree_names = [];
	const dialog_variable_fields = [];
	const seen_vars = new Set();
	for (const att of attachments) {
		const tree = att.tree_id ? trees[att.tree_id] : null;
		if (!tree) continue;
		tree_names.push(tree.name || tree.id);
		for (const f of build_dialog_variable_fields(actor, tree)) {
			if (seen_vars.has(f.key)) continue;
			seen_vars.add(f.key);
			dialog_variable_fields.push(f);
		}
	}

	return {
		tree_names,
		dialog_variable_fields,
	};
}

export function wire_dialog_tab_events(html, sheet) {
	const actor = resolve_actor_for_flags(sheet?.actor);
	if (!actor) return;

	const root = _dialog_tab_root(html);

	// Remember defs for the save handler (type coercion per key).
	const defs_by_key = {};
	root.querySelectorAll("[data-dialog-var]").forEach((el) => {
		const key = el.dataset.dialogVar;
		const type = el.dataset.varType;
		if (key) defs_by_key[key] = { type };
	});

	root.querySelectorAll("[data-dialog-var]").forEach((el) => {
		if (el.dataset.wired) return;
		el.dataset.wired = "1";
		el.addEventListener("change", async () => {
			const key = el.dataset.dialogVar;
			if (!key) return;
			const def = defs_by_key[key];
			const val = def?.type === "boolean" ? el.checked : (def?.type === "number" ? Number(el.value) : el.value);
			const vars = foundry.utils.duplicate(actor.getFlag(MODULE_ID, "dialog_variables") || {});
			if (val === "" || val === null || val === undefined) delete vars[key];
			else vars[key] = val;
			// Write the WHOLE module flags object with recursive:false so keys
			// removed from dialog_variables are actually dropped from the DB.
			const module_flags = foundry.utils.deepClone(actor.flags[MODULE_ID]) || {};
			module_flags.dialog_variables = foundry.utils.deepClone(vars);
			await actor.update(
				{ flags: { [MODULE_ID]: module_flags } },
				{ render: false, recursive: false }
			);
		});
	});

	root.querySelector("[data-action='open-patrol-hub']")?.addEventListener("click", () => {
		game.modules.get(MODULE_ID)?.api?.open_panel?.();
	});
}
