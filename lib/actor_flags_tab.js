/**
 * actor_flags_tab.js — Flags tab for Deadlands character sheets (GM-only).
 *
 * A flag editor so the GM can set/reset drift_* quest flags during testing.
 * Two scopes: player-scope `quest_flags` (drift_met_*, drift_know_*) and
 * posse-scope `posse_quest_flags` (drift_*). Values are coerced to
 * boolean/number for known drift_* keys, else kept as strings.
 */

import { resolve_actor_for_flags } from "./bt_variables.js";

const MODULE_ID = "dc-npc-patrols";

/** Known drift_* flag keys → value type for coercion. */
const DRIFT_FLAG_TYPES = {
	drift_m_a1: "boolean",
	drift_m_a2: "boolean",
	drift_m_a3: "boolean",
	drift_m_a4: "boolean",
	drift_met_sadie: "boolean",
	drift_met_gideon: "boolean",
	drift_met_percival: "boolean",
	drift_met_jasper: "boolean",
	drift_met_eugene: "boolean",
	drift_met_mayor: "boolean",
	drift_met_farms: "boolean",
	drift_know_sadie_shadow: "boolean",
	drift_know_sadie_job: "boolean",
	drift_know_foreclosure: "boolean",
	drift_choice_patron: "text",
	drift_choice_foreclosure: "text",
	drift_trust_sadie: "number",
	drift_trust_sadie_loan_awarded: "boolean",
};

function _coerce_value(key, raw) {
	const type = DRIFT_FLAG_TYPES[key] || "text";
	if (type === "boolean") {
		if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
		if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
		return raw;
	}
	if (type === "number") {
		const n = Number(raw);
		return Number.isNaN(n) ? raw : n;
	}
	return raw;
}

function _rows_for(flags) {
	return Object.entries(flags || {}).map(([key, value]) => ({
		key,
		value: String(value),
	}));
}

/** Tab panel div — not the nav link (both share data-tab). */
function _flags_tab_root(html) {
	if (!html?.querySelector) return html;
	return html.querySelector('div.tab[data-tab="patrol_flags"]')
		?? html.querySelector(".dc-patrol-flags-tab")?.closest(".tab")
		?? html;
}

export async function prepare_flags_tab_context(actor) {
	return {
		player_flags: _rows_for(actor.getFlag(MODULE_ID, "quest_flags")),
		posse_flags: _rows_for(actor.getFlag(MODULE_ID, "posse_quest_flags")),
	};
}

async function _write_flags(actor, scope, rows) {
	const obj = {};
	for (const row of rows) {
		if (!row.key) continue;
		obj[row.key] = _coerce_value(row.key, row.value);
	}
	// Write the WHOLE module flags object with recursive:false so keys removed
	// from the flag object are actually dropped from the DB.
	const module_flags = foundry.utils.deepClone(actor.flags[MODULE_ID]) || {};
	module_flags[scope] = foundry.utils.deepClone(obj);
	await actor.update(
		{ flags: { [MODULE_ID]: module_flags } },
		{ render: false, recursive: false }
	);
}

export function wire_flags_tab_events(html, sheet) {
	const actor = resolve_actor_for_flags(sheet?.actor);
	if (!actor) return;

	const root = _flags_tab_root(html);
	if (!root) return;

	// Collect rows for a scope from the DOM.
	function collect_rows(scope) {
		const rows = [];
		root.querySelectorAll(`[data-flag-row="${scope}"]`).forEach((row) => {
			const key = row.querySelector("[data-flag-key-input]")?.value ?? "";
			const value = row.querySelector("[data-flag-value-input]")?.value ?? "";
			rows.push({ key, value });
		});
		return rows;
	}

	// Change events on existing rows.
	root.querySelectorAll("[data-flag-row]").forEach((row) => {
		if (row.dataset.wired) return;
		row.dataset.wired = "1";
		row.querySelectorAll("input").forEach((el) => {
			el.addEventListener("change", async () => {
				const scope = row.dataset.flagRow;
				await _write_flags(actor, scope, collect_rows(scope));
			});
		});
	});

	// Add-row buttons.
	root.querySelectorAll("[data-action='add-flag']").forEach((btn) => {
		if (btn.dataset.wired) return;
		btn.dataset.wired = "1";
		btn.addEventListener("click", async () => {
			const scope = btn.dataset.flagScope;
			const rows = collect_rows(scope);
			rows.push({ key: "", value: "" });
			await _write_flags(actor, scope, rows);
			sheet?.render?.();
		});
	});

	// Delete-row buttons.
	root.querySelectorAll("[data-action='delete-flag']").forEach((btn) => {
		if (btn.dataset.wired) return;
		btn.dataset.wired = "1";
		btn.addEventListener("click", async () => {
			const scope = btn.dataset.flagScope;
			const index = Number(btn.dataset.flagIndex);
			const rows = collect_rows(scope);
			if (index >= 0 && index < rows.length) rows.splice(index, 1);
			await _write_flags(actor, scope, rows);
			sheet?.render?.();
		});
	});
}
