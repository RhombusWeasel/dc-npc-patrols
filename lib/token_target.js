/**
 * token_target.js — Token query, targeting, and range helpers for BT nodes.
 */

import { resolve_actor } from "./gear_actions.js";

const DISPOSITION_VALUES = {
	any: null,
	hostile: CONST.TOKEN_DISPOSITIONS?.HOSTILE ?? -1,
	neutral: CONST.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0,
	friendly: CONST.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1,
};

const ACTOR_TYPE_OPTIONS = {
	any: "Any",
	character: "Character",
	npc: "NPC",
	critter: "Critter",
	abomination: "Abomination",
};

const DISPOSITION_OPTIONS = {
	any: "Any",
	hostile: "Hostile",
	neutral: "Neutral",
	friendly: "Friendly",
};

const SOURCE_OPTIONS = {
	scene_scan: "Scene Scan",
	blackboard_list: "Blackboard List",
};

const MEASURE_MODE_OPTIONS = {
	grid_squares: "Grid Squares",
	combat_grid: "Combat Grid",
	pixels: "Pixels",
};

function _token_center(token_doc) {
	return token_doc.getCenterPoint?.() ?? { x: token_doc.x, y: token_doc.y };
}

export function distance_px(from_doc, to_doc) {
	const a = _token_center(from_doc);
	const b = _token_center(to_doc);
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	return Math.sqrt(dx * dx + dy * dy);
}

export function build_token_record(observer_doc, target_doc, grid_size) {
	const distance_px_val = distance_px(observer_doc, target_doc);
	const center = _token_center(target_doc);
	return {
		token_id: target_doc.id,
		actor_id: target_doc.actor?.id ?? null,
		name: target_doc.name || target_doc.actor?.name || "Unknown",
		is_player: !!target_doc.actor?.hasPlayerOwner,
		actor_type: target_doc.actor?.type ?? null,
		disposition: target_doc.disposition ?? 0,
		distance_px: distance_px_val,
		distance_squares: distance_px_val / grid_size,
		x: center.x,
		y: center.y,
	};
}

export function resolve_token_ref(bb, key = "target") {
	const record = bb?.[key];
	if (!record?.token_id || !bb?.scene) return null;
	return bb.scene.tokens.get(record.token_id) ?? null;
}

export function resolve_actor_ref(bb, key = "target") {
	const token_doc = resolve_token_ref(bb, key);
	if (token_doc?.actor) return resolve_actor(token_doc.actor);
	const record = bb?.[key];
	if (record?.actor_id) return game.actors.get(record.actor_id) ?? null;
	return null;
}

export function matches_token_filter(token_doc, options = {}) {
	if (!token_doc) return false;

	const observer_id = options.observer_id;
	if (options.exclude_self !== false && observer_id && token_doc.id === observer_id) {
		return false;
	}

	if (options.exclude_hidden !== false && token_doc.hidden) return false;

	const filter = options.filter || "all";
	const is_player = !!token_doc.actor?.hasPlayerOwner;
	if (filter === "players" && !is_player) return false;
	if (filter === "npcs" && is_player) return false;

	const actor_type = options.actor_type || "any";
	if (actor_type !== "any" && token_doc.actor?.type !== actor_type) return false;

	const disposition = options.disposition || "any";
	if (disposition !== "any") {
		const expected = DISPOSITION_VALUES[disposition];
		if (expected !== null && token_doc.disposition !== expected) return false;
	}

	const name_contains = (options.name_contains || "").trim().toLowerCase();
	if (name_contains) {
		const name = String(token_doc.name || token_doc.actor?.name || "").toLowerCase();
		if (!name.includes(name_contains)) return false;
	}

	return true;
}

function _record_matches_filter(record, options = {}) {
	if (!record) return false;

	const filter = options.filter || "all";
	if (filter === "players" && !record.is_player) return false;
	if (filter === "npcs" && record.is_player) return false;

	const actor_type = options.actor_type || "any";
	if (actor_type !== "any" && record.actor_type !== actor_type) return false;

	const disposition = options.disposition || "any";
	if (disposition !== "any") {
		const expected = DISPOSITION_VALUES[disposition];
		if (expected !== null && record.disposition !== expected) return false;
	}

	const name_contains = (options.name_contains || "").trim().toLowerCase();
	if (name_contains) {
		const name = String(record.name || "").toLowerCase();
		if (!name.includes(name_contains)) return false;
	}

	return true;
}

export function measure_token_range(from_doc, to_doc, mode = "grid_squares") {
	if (!from_doc || !to_doc) return null;

	if (mode === "pixels") {
		return distance_px(from_doc, to_doc);
	}

	if (mode === "combat_grid" && game.dc?.combat_actor?.measure_token_distance) {
		return game.dc.combat_actor.measure_token_distance(from_doc.id, to_doc.id, 1);
	}

	const scene = from_doc.parent;
	const grid_size = scene?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
	return distance_px(from_doc, to_doc) / grid_size;
}

export function write_target_to_blackboard(bb, record, key = "target") {
	bb[key] = record;
	bb[`nearest_${key}`] = record;
	delete bb[`${key}_range`];
}

export function find_closest_from_records(records, observer_doc, options = {}) {
	if (!observer_doc || !Array.isArray(records)) return null;

	const scene = observer_doc.parent;
	if (!scene) return null;

	const grid_size = scene.grid.size;
	const max_range = Number(options.max_range) || 0;
	let best = null;
	let best_dist = Infinity;

	for (const record of records) {
		if (!_record_matches_filter(record, options)) continue;

		const target_doc = scene.tokens.get(record.token_id);
		if (!target_doc) continue;
		if (!matches_token_filter(target_doc, { ...options, observer_id: observer_doc.id })) continue;

		const dist = record.distance_px ?? distance_px(observer_doc, target_doc);
		if (max_range > 0 && dist > max_range * grid_size) continue;

		if (dist < best_dist) {
			best_dist = dist;
			best = build_token_record(observer_doc, target_doc, grid_size);
		}
	}

	return best;
}

export function find_closest_token(observer_token_doc, options = {}) {
	if (!canvas?.ready || !observer_token_doc) return null;

	const scene = observer_token_doc.parent;
	if (!scene) return null;

	const grid_size = scene.grid.size;
	const max_range = Number(options.max_range) || 0;
	const observer_level = observer_token_doc._source?.level ?? observer_token_doc.level;

	let best = null;
	let best_dist = Infinity;

	for (const target_doc of scene.tokens) {
		if (!matches_token_filter(target_doc, {
			...options,
			observer_id: observer_token_doc.id,
		})) continue;

		const target_level = target_doc._source?.level ?? target_doc.level;
		if (target_level !== observer_level) continue;

		const dist = distance_px(observer_token_doc, target_doc);
		if (max_range > 0 && dist > max_range * grid_size) continue;

		if (dist < best_dist) {
			best_dist = dist;
			best = build_token_record(observer_token_doc, target_doc, grid_size);
		}
	}

	return best;
}

export function get_actor_type_options() {
	return { ...ACTOR_TYPE_OPTIONS };
}

export function get_disposition_options() {
	return { ...DISPOSITION_OPTIONS };
}

export function get_target_source_options() {
	return { ...SOURCE_OPTIONS };
}

export function get_measure_mode_options() {
	return { ...MEASURE_MODE_OPTIONS };
}

export function get_flag_operator_options() {
	return {
		exists: "Exists",
		not_exists: "Does Not Exist",
		equals: "Equals",
		not_equals: "Not Equals",
		greater: "Greater Than",
		less: "Less Than",
		greater_eq: "Greater or Equal",
		less_eq: "Less or Equal",
		contains: "Contains",
		starts_with: "Starts With",
	};
}
