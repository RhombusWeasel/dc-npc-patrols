/**
 * modify_quest boon handler — mutate a posse's quest instance state.
 *
 * Modes:
 *   'add'       — create a quest instance from the definition snapshot
 *                 (idempotent: merges missing fields, keeps existing stage/vars)
 *   'set_stage' — set the stage index (clamped to 0..stages.length;
 *                 writing stages.length marks the quest completed)
 *   'advance'   — stage + 1 (clamped; crossing into stages.length completes)
 *   'complete'  — mark completed with the current campaign day
 *   'set_var'   — set a tracking variable (coerced by the def's declared type)
 *   'delete'    — remove the quest instance
 *
 * Fields: mode, quest_id (existing quest definition id), stage (number),
 * var_key, var_value. scope_type must be 'posse' (actor scope warns/no-ops).
 *
 * Runs on the triggering client; writes route through request_quest_write
 * (direct posse call as GM, socket round-trip as player).
 *
 * @param {object} boon   — { type, mode, quest_id, stage, var_key, var_value, scope_type }
 * @param {object} context — mutable context from trigger_manager
 */

import { get_quest_def } from "../quest_store.js";
import { request_quest_write, get_cached_quests, get_current_quests } from "../quest_socket.js";

const MODULE_ID = "dc-npc-patrols";

export default async function modify_quest(boon, context) {
	const actor = context.actor;
	if (!actor) return;

	const mode = boon.mode || "add";
	const quest_id = boon.quest_id;
	if (!quest_id) return;

	if ((boon.scope_type || "posse") !== "posse") {
		console.warn(`[${MODULE_ID}|modify_quest] only posse scope is supported — no-op.`);
		return;
	}

	const posse = game.dc.posse?.get_posse_for_actor(actor);
	if (!posse) {
		console.warn(`[${MODULE_ID}|modify_quest] actor ${actor.id} has no posse — no-op.`);
		return;
	}

	const def = get_quest_def(quest_id);

	if (mode === "add") {
		if (!def) {
			console.warn(`[${MODULE_ID}|modify_quest] quest def not found: ${quest_id}`);
			return;
		}
		await _add(posse, def);
		return;
	}

	if (mode === "delete") {
		await request_quest_write("delete", { posse_id: posse.id, quest_id });
		return;
	}

	// Remaining modes mutate an existing instance — read the current state
	// (cache on non-GM clients; authoritative store on the GM client is what
	// the write path sees anyway when the GM applies the op).
	const quests = get_current_quests(posse.id);
	const quest = quests[quest_id];
	if (!quest) {
		console.warn(`[${MODULE_ID}|modify_quest] posse has no quest ${quest_id} (mode ${mode}) — no-op. Use 'add' first.`);
		return;
	}

	const updated = foundry.utils.deepClone(quest);

	if (mode === "complete") {
		updated.completed = _campaign_day();
	} else if (mode === "set_stage") {
		_set_stage(updated, Number(boon.stage) || 0);
	} else if (mode === "advance") {
		_set_stage(updated, (Number(updated.stage) || 0) + 1);
	} else if (mode === "set_var") {
		if (!def) {
			console.warn(`[${MODULE_ID}|modify_quest] quest def not found: ${quest_id} — cannot coerce var type.`);
			return;
		}
		_set_var(def, updated, boon.var_key, boon.var_value);
	} else {
		console.warn(`[${MODULE_ID}|modify_quest] unknown mode: ${mode}`);
		return;
	}

	await request_quest_write("set", { posse_id: posse.id, quest_id, data: updated });
}

/**
 * Create-or-merge a quest instance from its definition.
 */
async function _add(posse, def) {
	const quests = get_current_quests(posse.id);
	const existing = quests[def.id];
	if (existing) {
		// Idempotent merge: keep live state, fill any missing snapshot fields.
		const merged = foundry.utils.deepClone(existing);
		merged.title = existing.title || def.title;
		merged.giver = existing.giver || def.giver;
		merged.notes = existing.notes || def.notes;
		merged.stages = Array.isArray(existing.stages) && existing.stages.length ? existing.stages : [...(def.stages || [])];
		merged.vars = existing.vars || {};
		await request_quest_write("set", { posse_id: posse.id, quest_id: def.id, data: merged });
		return;
	}
	const instance = {
		id: def.id,
		title: def.title,
		giver: def.giver || "",
		notes: def.notes || "",
		stages: [...(def.stages || [])],
		vars: {},
		stage: 0,
		started: _campaign_day(),
		completed: null,
	};
	for (const v of def.vars || []) {
		instance.vars[v.key] = v.default !== undefined ? v.default : (v.type === "number" ? 0 : (v.type === "boolean" ? false : ""));
	}
	await request_quest_write("set", { posse_id: posse.id, quest_id: def.id, data: instance });
}

/**
 * Clamp-and-apply a stage index; crossing into stages.length stamps completed.
 */
function _set_stage(quest, value) {
	const max = Array.isArray(quest.stages) ? quest.stages.length : 0;
	const stage = Math.max(0, Math.min(value, max));
	quest.stage = stage;
	if (stage >= max && max > 0 && !quest.completed) {
		quest.completed = _campaign_day();
	}
}

/**
 * Set a tracking variable, coerced by the def's declared type.
 */
function _set_var(def, quest, key, raw) {
	const decl = (def.vars || []).find((v) => v.key === key);
	if (!decl) {
		console.warn(`[${MODULE_ID}|modify_quest] var "${key}" not declared on quest def ${def.id} — no-op.`);
		return;
	}
	quest.vars = quest.vars || {};
	if (decl.type === "number") {
		quest.vars[key] = Number(raw) || 0;
	} else if (decl.type === "boolean") {
		quest.vars[key] = raw === true || raw === "true";
	} else {
		quest.vars[key] = String(raw ?? "");
	}
}

/**
 * Get the current campaign day as "YYYY-MM-DD" (DC system campaign time,
 * unixtime + longitude offset). Duplicated from dialog_behaviors.js — the
 * module can't be imported system-side and vice versa.
 * @returns {string|null}
 */
function _campaign_day() {
	try {
		const lng = game.dc.get_campaign_lng();
		const off = Math.round((lng / 15) * 60) * 60000;
		const s = new Date(game.dc.get_unixtime() + off);
		return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
	} catch {
		return null;
	}
}