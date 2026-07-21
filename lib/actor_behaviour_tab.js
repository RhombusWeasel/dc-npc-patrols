/**
 * actor_behaviour_tab.js — Behaviour tab for Deadlands actor sheets.
 */

import { get_bt } from "./bt_store.js";
import {
	build_variable_fields,
	resolve_actor_for_flags,
	wire_bt_variable_events,
} from "./bt_variables.js";

const MODULE_ID = "dc-npc-patrols";

/** Tab panel div — not the nav link (both share data-tab). */
function _behaviour_tab_root(html) {
	if (!html?.querySelector) return html;
	return html.querySelector('div.tab[data-tab="patrol_behaviour"]')
		?? html.querySelector(".dc-patrol-behaviour-tab")?.closest(".tab")
		?? html;
}

export async function prepare_behaviour_tab_context(actor) {
	const bt_id = actor.getFlag(MODULE_ID, "bt_id");
	const tree = bt_id ? get_bt(bt_id) : null;

	return {
		bt_id,
		bt_name: tree?.name || bt_id || "",
		bt_description: tree?.description || "",
		bt_variable_fields: build_variable_fields(actor, bt_id),
	};
}

export function wire_behaviour_tab_events(html, sheet) {
	const actor = resolve_actor_for_flags(sheet?.actor);
	if (!actor) return;
	const bt_id = actor.getFlag(MODULE_ID, "bt_id");
	if (!bt_id) return;

	const root = _behaviour_tab_root(html);
	wire_bt_variable_events(root, actor, bt_id);

	root.querySelector("[data-action='open-patrol-hub']")?.addEventListener("click", () => {
		game.modules.get(MODULE_ID)?.api?.open_panel?.();
	});

	root.querySelector("[data-action='edit-assigned-bt']")?.addEventListener("click", () => {
		game.modules.get(MODULE_ID)?.api?.open_hub_for_actor?.(actor.id, { bt_id });
	});
}

export function wire_hub_bt_variable_events(html, actor, bt_id, token_doc = null) {
	if (!html || !actor || !bt_id) return;
	const section = html.querySelector(".hub-bt-variables");
	if (section) wire_bt_variable_events(section, actor, bt_id, token_doc);
}
