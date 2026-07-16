/**
 * gear_actions.js — NPC inventory equip/use helpers for BT nodes.
 * Mirrors ActorSheetDeadlands._onEquipChange and _onUseItem.
 */

import { gear_path_by_label } from "../../../systems/Deadlands-Classic/module/lib/condition_eval.js";

/** Match actor sheet / save_actor resolution — fresh world actor when linked. */
export function resolve_actor(actor) {
	if (!actor) return null;
	if (!actor.isToken) return game.actors.get(actor.id) ?? actor;
	return actor;
}

export function resolve_gear_path(actor, label) {
	actor = resolve_actor(actor);
	if (!label || !actor?.system?.char?.gear) return null;
	const needle = String(label).toLowerCase().trim();
	if (!needle) return null;

	const matches = [];
	if (game.dc?.act?.items?.list_equipment_paths) {
		for (const path of game.dc.act.items.list_equipment_paths(actor)) {
			const item = game.dc.utils.data_from_path(actor.system.char.gear, path);
			const item_label = item?.label ?? "";
			if (String(item_label).toLowerCase().includes(needle)) {
				matches.push(path);
			}
		}
	}
	if (!matches.length) {
		const fallback = gear_path_by_label(actor.system.char.gear, label);
		if (fallback) matches.push(fallback);
	}
	if (!matches.length) return null;
	if (matches.length === 1) return matches[0];

	// Prefer an item that can actually be equipped (avoids partial label collisions).
	for (const path of matches) {
		if (find_equip_slot(actor, path)) return path;
	}
	return matches[0];
}

export function get_equip_slot_options() {
	const opts = { auto: "Auto (first compatible)" };
	const locations = game.dc?.system?.equipment?.locations;
	if (!locations) {
		opts.main_hand = "Main Hand";
		opts.off_hand = "Off Hand";
		opts.hands = "Two Hands";
		return opts;
	}
	for (const key of Object.keys(locations)) {
		if (key === "none") continue;
		const loc = game.i18n.localize(`dc.equipment.locations.${key}`);
		opts[key] = loc !== `dc.equipment.locations.${key}` ? loc : key;
	}
	return opts;
}

function split_gear_path(relative_gear_path) {
	const parts = relative_gear_path.split(".");
	const key = parts.pop();
	const collection = parts.join(".");
	return {
		key,
		path: `char.gear.${collection}`,
		item_path: `char.gear.${relative_gear_path}`,
		gear_collection_path: `gear.${collection}`,
	};
}

export function get_gear_item(actor, relative_gear_path) {
	actor = resolve_actor(actor);
	if (!actor || !relative_gear_path) return null;
	const { key, gear_collection_path } = split_gear_path(relative_gear_path);
	const collection = game.dc.utils.data_from_path(actor.system.char, gear_collection_path);
	return collection?.[key] ?? null;
}

function _item_equip_slot(item, gear_path) {
	if (item?.equip_slot) return item.equip_slot;
	if (gear_path?.startsWith("weapons.")) return "one_handed";
	return null;
}

function _normalize_slot_key(actor, slot_key) {
	if (!slot_key || slot_key === "auto") return "auto";
	if (actor.system.char?.slots?.[slot_key]) return slot_key;
	return "auto";
}

export function find_equip_slot(actor, gear_path) {
	actor = resolve_actor(actor);
	const slots = actor?.system?.char?.slots;
	if (!slots) return null;

	for (const slot_key of Object.keys(slots)) {
		const compatible = game.dc.act.items.gear_by_slot(actor, slot_key);
		if (compatible.includes(gear_path)) return slot_key;
	}

	const item = get_gear_item(actor, gear_path);
	const equip_slot = _item_equip_slot(item, gear_path);
	if (!equip_slot) return null;

	for (const slot_key of Object.keys(slots)) {
		if (game.dc.equip.slot_accepts_item(slot_key, equip_slot)) return slot_key;
	}
	return null;
}

export function is_gear_equipped(actor, gear_path) {
	actor = resolve_actor(actor);
	if (!actor || !gear_path) return false;
	const slots = actor.system.char?.slots;
	if (!slots) return false;

	for (const slot of Object.values(slots)) {
		const selected = slot?.selected;
		if (!selected || selected === "none") continue;
		if (selected === gear_path) return true;
		// Weapon split paths: weapons.ranged.colt_2 vs weapons.ranged.colt
		if (selected.startsWith(`${gear_path}_`)) return true;
	}
	return false;
}

export async function equip_item(actor, gear_path, slot_key = "auto") {
	if (!game.dc) return { ok: false, reason: "game.dc unavailable" };

	actor = resolve_actor(actor);
	if (!actor || !gear_path) return { ok: false, reason: "missing actor or gear path" };

	const item = get_gear_item(actor, gear_path);
	if (!item) return { ok: false, reason: `item not found at ${gear_path}` };

	let slot = _normalize_slot_key(actor, slot_key);
	if (slot === "auto") slot = find_equip_slot(actor, gear_path);
	if (!slot) return { ok: false, reason: `no compatible slot for ${gear_path}` };

	const equip_slot = _item_equip_slot(item, gear_path);
	if (equip_slot && !game.dc.equip.slot_accepts_item(slot, equip_slot)) {
		return { ok: false, reason: `slot ${slot} rejects equip_slot ${equip_slot}` };
	}

	let path = gear_path;
	const prev_slots = actor.system.char.slots;
	const previously_selected = new Set(
		Object.values(prev_slots || {})
			.map((s) => s?.selected)
			.filter((p) => p && p !== "none")
	);

	const slots = foundry.utils.deepClone(prev_slots);
	const gear = foundry.utils.deepClone(actor.system.char.gear);

	const split = game.dc.equip.split_weapon_for_hand(gear, slots, slot, path);
	if (split.blocked) return { ok: false, reason: "dual-wield blocked (need duplicate weapon)" };
	path = split.path;

	slots[slot].selected = path;
	game.dc.equip.resolve_equip_conflicts(slots, slot, path);

	const live_gear = actor.system.char.gear;
	const gear_changed = JSON.stringify(gear) !== JSON.stringify(live_gear);

	if (gear_changed) {
		await game.dc.utils.save_actor(actor, (system) => {
			system.char.gear = gear;
		}, { render: false });
	}
	await game.dc.utils.save_actor(actor, { "system.char.slots": slots }, { render: false });

	const now_selected = new Set(
		Object.values(slots)
			.map((s) => s?.selected)
			.filter((p) => p && p !== "none")
	);
	for (const old_path of previously_selected) {
		if (!now_selected.has(old_path)) {
			await game.dc.temp_boons.cancel_by_source(actor, old_path);
		}
	}
	return { ok: true };
}

export async function unequip_item(actor, gear_path) {
	if (!game.dc) return { ok: false, reason: "game.dc unavailable" };

	actor = resolve_actor(actor);
	if (!actor || !gear_path) return { ok: false, reason: "missing actor or gear path" };

	const prev_slots = actor.system.char?.slots;
	if (!prev_slots) return { ok: false, reason: "actor has no slots" };

	let slot_key = null;
	for (const [key, slot] of Object.entries(prev_slots)) {
		const selected = slot?.selected;
		if (!selected || selected === "none") continue;
		if (selected === gear_path || selected.startsWith(`${gear_path}_`)) {
			slot_key = key;
			break;
		}
	}
	if (!slot_key) return { ok: false, reason: `${gear_path} not equipped` };

	const previously_selected = new Set(
		Object.values(prev_slots)
			.map((s) => s?.selected)
			.filter((p) => p && p !== "none")
	);

	const slots = foundry.utils.deepClone(prev_slots);
	slots[slot_key].selected = "none";
	game.dc.equip.resolve_equip_conflicts(slots, slot_key, "none");

	await game.dc.utils.save_actor(actor, { "system.char.slots": slots }, { render: false });

	const now_selected = new Set(
		Object.values(slots)
			.map((s) => s?.selected)
			.filter((p) => p && p !== "none")
	);
	for (const old_path of previously_selected) {
		if (!now_selected.has(old_path)) {
			await game.dc.temp_boons.cancel_by_source(actor, old_path);
		}
	}
	return { ok: true };
}

export async function use_item(actor, relative_gear_path) {
	if (!game.dc || !actor || !relative_gear_path) return false;

	actor = resolve_actor(actor);
	const { key, path, item_path, gear_collection_path } = split_gear_path(relative_gear_path);
	const char = actor.system.char;
	const collection = game.dc.utils.data_from_path(char, gear_collection_path);
	const item = collection?.[key];
	if (!item) return false;
	if (!game.dc.utils.has_boon_trigger(item, "on_use")) return false;

	const consume_amount = game.dc.utils.consume_amount_from_boons(item.boons);

	if (consume_amount > 0) {
		await game.dc.utils.save_actor(actor, (system) => {
			const coll = game.dc.utils.data_from_path(system, path);
			if (!coll || !coll[key]) return;
			const gear_item = coll[key];
			gear_item.count = Math.max(0, game.dc.utils.adjust_gear_count(gear_item.count, -consume_amount));
		});
	}

	const char_after = actor.system.char;
	const collection_after = game.dc.utils.data_from_path(char_after, gear_collection_path);
	const used_item = collection_after?.[key] ?? item;
	if (!used_item?.boons?.length) return true;

	const has_timer = used_item.boons.some((b) =>
		b.type === "timer" && game.dc.trigger_manager._trigger_matches(b.trigger, "on_use")
	);
	if (has_timer && game.dc.light.has_active_timer(actor, item_path)) {
		await game.dc.temp_boons.cancel_by_source(actor, item_path);
		const other_boons = used_item.boons.filter((b) =>
			!(b.type === "timer" && game.dc.trigger_manager._trigger_matches(b.trigger, "on_use"))
		);
		if (!other_boons.length) return true;
		const ctx = game.dc.trigger_manager.create_context("on_use", { actor, item_path });
		for (const boon of other_boons) {
			if (game.dc.trigger_manager._trigger_matches(boon.trigger, "on_use")) {
				game.dc.boon_manager.handleBoon(boon, ctx);
			}
		}
		await game.dc.trigger_manager.persist_updates(actor, ctx);
		return true;
	}

	const ctx = game.dc.trigger_manager.create_context("on_use", { actor, item_path });
	game.dc.trigger_manager.fire_from_source(used_item, "on_use", ctx);
	await game.dc.trigger_manager.persist_updates(actor, ctx);

	if (ctx.satisfy_craving_indices?.length) {
		const now = game.settings.get("Deadlands-Classic", "unixtime");
		const indices = new Set(ctx.satisfy_craving_indices);
		await game.dc.utils.save_actor(actor, (system) => {
			for (const idx of indices) {
				if (system.char.boons[idx]) {
					system.char.boons[idx].last_satisfied = now;
				}
			}
		});
	}
	return true;
}
