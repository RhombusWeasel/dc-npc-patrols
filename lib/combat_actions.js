/**
 * combat_actions.js — NPC weapon reload helpers for BT nodes.
 */

import { resolve_actor, resolve_gear_path, get_gear_item } from "./gear_actions.js";
import { is_dc_combat_active } from "./combat_turn.js";

function _attack_type_for_path(weapon_path) {
	if (!weapon_path) return "melee";
	if (weapon_path.startsWith("weapons.melee")) return "melee";
	if (weapon_path.startsWith("weapons.thrown")) return "thrown";
	if (weapon_path.startsWith("weapons.explosives")) return "explosive";
	return "ranged";
}

export function resolve_equipped_weapon(actor, slot_key = "main_hand", token_doc = null) {
	actor = resolve_actor(actor, token_doc);
	if (!actor || !game.dc) return null;

	const selected = actor.system.char?.slots?.[slot_key]?.selected;
	if (!selected || selected === "none") return null;

	const weapon = get_gear_item(actor, selected);
	return {
		weapon_path: selected,
		attack_type: _attack_type_for_path(selected),
		weapon,
		slot_key,
	};
}

async function _preview_char_with_boons(actor, situation) {
	const ctx = game.dc.trigger_manager.create_context(situation, { actor });
	game.dc.trigger_manager.fire(actor, situation, ctx);
	return game.dc.resolve_context.resolve_context(actor, ctx, { display_only: true });
}

function _speed_reload_formula(char) {
	const deft = char?.attributes?.deftness ?? {};
	const sides = deft.sides ?? 6;
	const speed = char?.skills?.speed_loadin;
	if ((speed?.value ?? 0) > 0) {
		const mod = (speed.mod ?? 0) + (deft.mod ?? 0);
		return mod ? `${speed.value}d${sides}ex + ${mod}` : `${speed.value}d${sides}ex`;
	}
	const value = deft.value ?? 1;
	return `${value}d${sides}ex`;
}

function _finalize_reload_result(result) {
	if (!result.ok) {
		if (result.reason) game.dc?.ammo?.notify_load_failure?.(result.reason);
		return result;
	}
	if (result.reason === "already_loaded") return result;
	if ((result.amount ?? 0) < 1) {
		return { ok: false, reason: result.reason ?? "no_rounds_loaded" };
	}
	return result;
}

async function _normalize_weapon_ammo(actor, weapon_path) {
	const gear = foundry.utils.deepClone(actor.system.char.gear);
	const weapon = game.dc.utils.data_from_path(gear, weapon_path);
	if (!weapon) return { ok: false, reason: "weapon not found" };

	game.dc.ammo.migrate_weapon_ammo_fields(weapon);
	game.dc.ammo.normalize_loaded_rounds(gear, weapon);
	game.dc.utils.modify_path(gear, weapon_path, weapon);

	const live_weapon = game.dc.utils.data_from_path(actor.system.char.gear, weapon_path);
	if (JSON.stringify(weapon) !== JSON.stringify(live_weapon)) {
		await game.dc.utils.save_actor(actor, (system) => {
			system.char.gear = gear;
		}, { render: false });
	}

	return { ok: true, weapon };
}

async function _speed_reload_transfer(actor, weapon_path, r_data) {
	const amount_raw = game.dc.ammo.speed_load_rounds_from_roll(r_data);
	if (amount_raw < 1) return { ok: false, reason: "speed_load_failed", amount: 0 };

	const gear = foundry.utils.deepClone(actor.system.char.gear);
	const weapon = game.dc.utils.data_from_path(gear, weapon_path);
	if (!weapon) return { ok: false, reason: "weapon not found" };

	game.dc.ammo.normalize_loaded_rounds(gear, weapon);
	const { reload_path } = game.dc.ammo.resolve_reload_selection(actor, weapon_path, weapon);
	const capacity = game.dc.ammo.weapon_capacity(weapon) - weapon.loaded_rounds.length;
	const reload_ammo = game.dc.ammo.reload_ammo(actor, weapon);
	const amount = Math.min(amount_raw, capacity, reload_ammo?.count ?? 0);
	if (amount < 1) return { ok: false, reason: "no_inventory", amount: 0 };

	const result = await game.dc.ammo.apply_transfer_rounds(actor, weapon_path, reload_path, amount);
	if (!result.ok) return result;
	return { ok: true, amount: result.amount ?? amount };
}

async function _combat_speed_reload(actor, weapon_path) {
	const char = await _preview_char_with_boons(actor, "on_reload_attempt");
	const formula = _speed_reload_formula(char);

	const r_data = await game.dc.roll_utils.build_roll_data(actor, {
		formula,
		type: "speed_reload",
		action_label: "Speed Loadin'",
		tn: 5,
		skip_fate_dialog: true,
	});
	if (!r_data) return { ok: false, reason: "roll failed" };

	game.dc.report_context.post(game.dc.report_context.speed_reload(actor, r_data), actor);
	const transfer = await _speed_reload_transfer(actor, weapon_path, r_data);

	if (r_data.success) {
		game.dc.trigger_manager.fire(actor, "on_reload_success", { actor });
	} else {
		game.dc.trigger_manager.fire(actor, "on_reload_failure", { actor });
	}

	return _finalize_reload_result(transfer);
}

function _resolve_weapon_path(actor, options = {}) {
	const slot_key = options.slot_key || "main_hand";
	if (options.weapon_label) {
		const weapon_path = resolve_gear_path(actor, options.weapon_label);
		if (!weapon_path) return { ok: false, reason: "weapon label not found" };
		if (_attack_type_for_path(weapon_path) === "melee") {
			return { ok: false, reason: "melee weapons cannot reload" };
		}
		return { ok: true, weapon_path, slot_key };
	}

	const equipped = resolve_equipped_weapon(actor, slot_key);
	if (!equipped) return { ok: false, reason: "no weapon equipped in slot" };
	if (_attack_type_for_path(equipped.weapon_path) === "melee") {
		return { ok: false, reason: "melee weapons cannot reload" };
	}
	return { ok: true, weapon_path: equipped.weapon_path, slot_key, weapon: equipped.weapon };
}

/**
 * Reload the attacker's equipped weapon using Deadlands ammo rules.
 * @returns {Promise<{ ok: boolean, reason?: string, amount?: number }>}
 */
export async function reload_equipped_weapon(actor, options = {}) {
	if (!game.dc) return { ok: false, reason: "game.dc unavailable" };
	if (!game.user.isGM) return { ok: false, reason: "GM client required" };

	actor = resolve_actor(actor, options.token_doc ?? null);
	if (!actor) return { ok: false, reason: "missing actor" };

	const resolved = _resolve_weapon_path(actor, options);
	if (!resolved.ok) return resolved;

	const { weapon_path } = resolved;
	const mode = options.mode || "auto";
	const normalized = await _normalize_weapon_ammo(actor, weapon_path);
	if (!normalized.ok) return normalized;

	const { reload_path } = game.dc.ammo.resolve_reload_selection(actor, weapon_path, normalized.weapon);
	if (!reload_path) return { ok: false, reason: "no ammo selected" };

	const use_speed_load = mode === "speed_load"
		|| (mode === "auto" && is_dc_combat_active());

	if (use_speed_load) {
		return _finalize_reload_result(await _combat_speed_reload(actor, weapon_path));
	}

	if (mode === "one") {
		const result = await game.dc.ammo.load_one_round(actor, weapon_path, reload_path);
		if (result.ok) {
			game.dc.trigger_manager.fire(actor, "on_reload_success", { actor });
		}
		return _finalize_reload_result(result.ok
			? { ok: true, amount: result.amount ?? 1 }
			: result);
	}

	const result = await game.dc.ammo.reload_to_capacity(actor, weapon_path, reload_path);
	if (!result.ok) {
		if (result.reason === "mag_full") {
			return { ok: true, amount: 0, reason: "already_loaded" };
		}
		return _finalize_reload_result(result);
	}
	game.dc.trigger_manager.fire(actor, "on_reload_success", { actor });
	return { ok: true, amount: result.amount ?? 0 };
}
