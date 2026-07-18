/**
 * inventory_actions.js — Add/remove gear on actors for BT nodes.
 */

import { gear_path_by_label } from "../../../systems/Deadlands-Classic/module/lib/condition_eval.js";
import { resolve_actor, resolve_gear_path } from "./gear_actions.js";

function _resolve_catalog_path(label) {
	if (!label || !game.dc?.system?.gear) return null;
	return gear_path_by_label(game.dc.system.gear, label);
}

function _resolve_item_path(actor, label, allow_catalog = false) {
	const actor_path = resolve_gear_path(actor, label);
	if (actor_path) return actor_path;
	if (allow_catalog) return _resolve_catalog_path(label);
	return null;
}

async function _persist_gear_changes(actor) {
	await game.dc.utils.save_actor(actor, (system) => {
		system.char.gear = foundry.utils.deepClone(actor.system.char.gear);
	}, { render: false });
}

/**
 * Add or remove gear by partial label match.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function modify_item_by_label(actor, label, delta) {
	if (!game.dc) return { ok: false, reason: "game.dc unavailable" };

	actor = resolve_actor(actor);
	if (!actor || !label) return { ok: false, reason: "missing actor or label" };

	const quantity = Math.abs(Number(delta) || 0);
	if (quantity <= 0) return { ok: false, reason: "invalid quantity" };

	const signed_delta = Number(delta);
	const allow_catalog = signed_delta > 0;
	const gear_path = _resolve_item_path(actor, label, allow_catalog);
	if (!gear_path) return { ok: false, reason: "item not found" };

	game.dc.act.items.modify(actor, gear_path, signed_delta);
	await _persist_gear_changes(actor);
	return { ok: true };
}

/**
 * Remove gear by partial label match.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function remove_item_by_label(actor, label, quantity = 1) {
	if (!game.dc) return { ok: false, reason: "game.dc unavailable" };

	actor = resolve_actor(actor);
	if (!actor || !label) return { ok: false, reason: "missing actor or label" };

	const gear_path = resolve_gear_path(actor, label);
	if (!gear_path) return { ok: false, reason: "item not found on actor" };

	const amount = Math.abs(Number(quantity) || 1);
	game.dc.act.items.remove(actor, gear_path, amount);
	await _persist_gear_changes(actor);
	return { ok: true };
}
