/**
 * combat_actions.js — NPC weapon attack helpers for BT nodes.
 * Mirrors ActorSheetDeadlands / act._macro_fire_weapon with explicit targets.
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

function _skill_for_weapon(weapon_path, weapon) {
	if (weapon_path?.includes("weapons.thrown")) {
		return weapon?.category ? `throwin_${weapon.category}` : "throwin";
	}
	if (!weapon) return "fightin_brawlin";
	return `${weapon.core_skill}_${weapon.category}`;
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
		skill: _skill_for_weapon(selected, weapon),
		weapon,
		slot_key,
	};
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

function _build_single_target(attacker_token_id, target_token_doc) {
	const placeable = canvas.tokens.get(target_token_doc.id);
	const target_ref = game.dc.combat_actor.target_ref_from_token(placeable);
	if (!target_ref) return null;

	target_ref.distance = game.dc.combat_actor.measure_token_distance(
		attacker_token_id,
		target_ref.token_id,
		1
	);
	return target_ref;
}

/**
 * Fire the attacker's equipped weapon at a target token.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function fire_equipped_weapon(attacker_actor, attacker_token_doc, target_token_doc, options = {}) {
	if (!game.dc) return { ok: false, reason: "game.dc unavailable" };
	if (!game.user.isGM) return { ok: false, reason: "GM client required" };

	attacker_actor = resolve_actor(attacker_actor, attacker_token_doc);
	if (!attacker_actor || !attacker_token_doc || !target_token_doc) {
		return { ok: false, reason: "missing attacker or target" };
	}

	const slot_key = options.slot_key || "main_hand";
	let weapon_path = options.weapon_path || null;
	let attack_type = options.attack_type || null;
	let skill = options.skill || null;
	let weapon = null;

	if (options.weapon_label) {
		weapon_path = resolve_gear_path(attacker_actor, options.weapon_label);
		if (!weapon_path) return { ok: false, reason: "weapon label not found" };
		weapon = get_gear_item(attacker_actor, weapon_path);
		attack_type = _attack_type_for_path(weapon_path);
		skill = _skill_for_weapon(weapon_path, weapon);
	} else {
		const equipped = resolve_equipped_weapon(attacker_actor, slot_key);
		if (!equipped) return { ok: false, reason: "no weapon equipped in slot" };
		weapon_path = equipped.weapon_path;
		attack_type = equipped.attack_type;
		skill = equipped.skill;
		weapon = equipped.weapon;
	}

	if (!skill || (!weapon_path && attack_type !== "melee")) {
		return { ok: false, reason: "invalid attack configuration" };
	}

	if (weapon_path) {
		const normalized = await _normalize_weapon_ammo(attacker_actor, weapon_path);
		if (!normalized.ok) return normalized;
		weapon = normalized.weapon;

		if (attack_type !== "melee" && (weapon.loaded ?? 0) < 1) {
			return { ok: false, reason: "chamber empty" };
		}
	}

	if (attack_type !== "melee" && weapon) {
		const attack_ammo = game.dc.ammo.resolve_attack_ammo(attacker_actor, weapon);
		if (!attack_ammo) return { ok: false, reason: "no ammo selected" };
	}

	const fire_shots = weapon ? game.dc.rof.clamp_fire_shots(weapon, weapon.fire_shots ?? 1) : 1;
	const attempt_ctx = game.dc.blast_boon.fire_attack_trigger(attacker_actor, "on_attack_attempt", {
		actor: attacker_actor,
		weapon_path,
		skill,
	});

	let reliability_info = null;
	if (weapon_path && weapon_path !== "none" && game.dc.rules?.is_active?.("reliability_checks")) {
		const rel_context = {
			skill,
			weapon_path,
			bonus_dice: attempt_ctx.bonus_dice || 0,
			penalty_dice: attempt_ctx.penalty_dice || 0,
			roll_mod: attempt_ctx.roll_mod || 0,
			boon_mods: attempt_ctx.boon_mods || [],
		};
		const rel_result = await game.dc.reliability.check_from_path(attacker_actor, weapon_path, rel_context);
		if (rel_result?.malfunction) {
			attempt_ctx.bonus_dice = rel_context.bonus_dice;
			attempt_ctx.penalty_dice = rel_context.penalty_dice;
			attempt_ctx.roll_mod = rel_context.roll_mod;
			if (rel_context.boon_mods.length > (attempt_ctx.boon_mods || []).length) {
				attempt_ctx.boon_mods = rel_context.boon_mods;
			}
			reliability_info = {
				item_label: rel_result.item?.label,
				reliability: rel_result.reliability,
				roll: rel_result.roll,
				malfunction: true,
			};
		}
	}

	const blast_cfg = game.dc.blast_boon.resolve_blast_from_context(attempt_ctx, weapon);
	const attacker_token_id = game.dc.combat_actor.attacker_token_id_for(attacker_actor, attacker_token_doc.id);
	let targets = [];
	let aoe_meta = null;
	let region_id = null;

	if (blast_cfg) {
		const atk_token = game.dc.combat_actor.token_placeable(attacker_token_id)
			?? game.dc.aoe.get_attacker_token(attacker_actor, attacker_token_id);
		if (!atk_token) return { ok: false, reason: "attacker token not on canvas" };

		const placement = await game.dc.aoe.place_blast_aoe(blast_cfg, weapon, atk_token, attacker_actor.name);
		if (!placement) return { ok: false, reason: "aoe placement cancelled" };

		targets = placement.targets;
		aoe_meta = placement.aoe;
		region_id = placement.region?.id ?? null;
	} else {
		const target_ref = _build_single_target(attacker_token_id, target_token_doc);
		if (!target_ref) return { ok: false, reason: "invalid target" };
		targets = [target_ref];
	}

	game.dc.combat_emit("register_attack", {
		attacker_id: attacker_actor.id,
		attacker_token_id,
		type: attack_type,
		skill,
		weapon_path,
		fire_shots,
		slot_key,
		bonus_dice: attempt_ctx.bonus_dice || 0,
		penalty_dice: attempt_ctx.penalty_dice || 0,
		boon_damage: attempt_ctx.damage || 0,
		targets,
		aoe: aoe_meta,
		region_id,
		reliability: reliability_info || null,
	});

	return { ok: true };
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
