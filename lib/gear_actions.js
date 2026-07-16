/**
 * gear_actions.js — NPC inventory equip/use helpers for BT nodes.
 * Mirrors ActorSheetDeadlands._onEquipChange and _onUseItem.
 */

import { gear_path_by_label } from "../../../systems/Deadlands-Classic/module/lib/condition_eval.js";

export function resolve_gear_path(actor, label) {
	if (!label || !actor?.system?.char?.gear) return null;
	return gear_path_by_label(actor.system.char.gear, String(label).trim());
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
	if (!actor || !relative_gear_path) return null;
	const { key, gear_collection_path } = split_gear_path(relative_gear_path);
	const collection = game.dc.utils.data_from_path(actor.system.char, gear_collection_path);
	return collection?.[key] ?? null;
}

export function find_equip_slot(actor, gear_path) {
	const slots = actor.system.char?.slots;
	if (!slots) return null;
	for (const slot_key of Object.keys(slots)) {
		const compatible = game.dc.act.items.gear_by_slot(actor, slot_key);
		if (compatible.includes(gear_path)) return slot_key;
	}
	return null;
}

export async function equip_item(actor, gear_path, slot_key = "auto") {
	if (!game.dc || !actor || !gear_path) return false;

	let slot = slot_key;
	if (slot === "auto") {
		slot = find_equip_slot(actor, gear_path);
	} else if (!actor.system.char.slots?.[slot]) {
		return false;
	}
	if (!slot) return false;

	const compatible = game.dc.act.items.gear_by_slot(actor, slot);
	if (!compatible.includes(gear_path)) return false;

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
	if (split.blocked) return false;
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
	return true;
}

export async function unequip_item(actor, gear_path) {
	if (!game.dc || !actor || !gear_path) return false;

	const prev_slots = actor.system.char?.slots;
	if (!prev_slots) return false;

	let slot_key = null;
	for (const [key, slot] of Object.entries(prev_slots)) {
		if (slot?.selected === gear_path) {
			slot_key = key;
			break;
		}
	}
	if (!slot_key) return false;

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
	return true;
}

export async function use_item(actor, relative_gear_path) {
	if (!game.dc || !actor || !relative_gear_path) return false;

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
