/**
 * token_vision.js — Foundry token vision helpers for BT blackboard.
 * Computes visibility from an observer NPC's sight config (GM-safe).
 */

import { build_token_record, distance_px } from "./token_target.js";

const TOKEN_FILTER_OPTIONS = {
	all: "All tokens",
	players: "Players only",
	npcs: "NPCs only",
};

function _is_canvas_token(obj) {
	return obj?.document?.documentName === "Token";
}

function _matches_filter(token_doc, filter) {
	const is_player = !!token_doc.actor?.hasPlayerOwner;
	if (filter === "players") return is_player;
	if (filter === "npcs") return !is_player;
	return true;
}

function _create_ephemeral_vision_source(observer) {
	const source = new CONFIG.Canvas.visionSourceClass({
		sourceId: `${observer.sourceId}.bt-vision`,
		object: observer,
	});
	source.initialize(observer._getVisionSourceData());
	return source;
}

function _test_from_vision_source(vision_source, target_placeable) {
	if (!vision_source || vision_source.isBlinded) return false;

	const points = target_placeable.document.getVisibilityTestPoints();
	const config = canvas.visibility._createVisibilityTestConfig(points, {
		tolerance: 0,
		object: target_placeable,
	});

	const modes = CONFIG.Canvas.detectionModes;
	const token_doc = vision_source.object.document;

	const basic_mode = token_doc.detectionModes.basicSight;
	if (basic_mode && modes.basicSight.testVisibility(vision_source, basic_mode, config)) {
		return true;
	}

	const light_mode = token_doc.detectionModes.lightPerception;
	if (light_mode && modes.lightPerception.testVisibility(vision_source, light_mode, config)) {
		return true;
	}

	if (!_is_canvas_token(target_placeable)) return false;

	for (const [id, mode] of Object.entries(token_doc.detectionModes)) {
		if (id === "basicSight" || id === "lightPerception") continue;
		const dm = modes[id];
		if (dm?.testVisibility(vision_source, mode, config)) return true;
	}
	return false;
}

function _can_observer_see_token(observer, target, vision_source) {
	if (!canvas.visibility.tokenVision) return true;
	return _test_from_vision_source(vision_source, target);
}

/**
 * Create an ephemeral vision source for an observer canvas token.
 * @param {Token} observer
 * @returns {PointVisionSource|null}
 */
export function create_observer_vision_source(observer) {
	if (!canvas?.visibility?.tokenVision || !observer) return null;
	return _create_ephemeral_vision_source(observer);
}

/**
 * Test whether an observer token document can see a target token document.
 * @param {TokenDocument} observer_token_doc
 * @param {TokenDocument} target_token_doc
 * @param {PointVisionSource|null} [vision_source]
 * @returns {boolean}
 */
export function can_observer_see_token_doc(observer_token_doc, target_token_doc, vision_source = null) {
	if (!canvas?.visibility?.tokenVision) return true;
	if (!observer_token_doc || !target_token_doc) return false;

	const observer = canvas.tokens.get(observer_token_doc.id);
	const target = canvas.tokens.get(target_token_doc.id);
	if (!observer || !target) return false;

	return _can_observer_see_token(observer, target, vision_source);
}

/**
 * Filter stored token records by filter type and optional name substring.
 * @param {object[]} records
 * @param {object} options
 * @returns {object[]}
 */
export function filter_token_records(records, options = {}) {
	const filter = options.filter || "all";
	const name_contains = (options.name_contains || "").trim().toLowerCase();
	let list = Array.isArray(records) ? records : [];

	if (filter === "players") list = list.filter((r) => r.is_player);
	else if (filter === "npcs") list = list.filter((r) => !r.is_player);

	if (name_contains) {
		list = list.filter((r) => String(r.name || "").toLowerCase().includes(name_contains));
	}
	return list;
}

/**
 * Write visible token scan results onto the blackboard.
 * @param {object} bb
 * @param {object[]} tokens
 * @param {string} key
 * @param {number} unixtime
 */
export function write_visible_tokens_to_blackboard(bb, tokens, key, unixtime) {
	bb[key] = tokens;
	bb[`${key}_count`] = tokens.length;
	bb[`nearest_${key}`] = tokens[0] ?? null;
	bb[`_${key}_updated`] = unixtime;

	if (key === "visible_tokens") {
		bb.visible_token_count = tokens.length;
		bb.nearest_visible = tokens[0] ?? null;
		bb._visible_tokens_updated = unixtime;
	}
}

/**
 * Scan scene tokens visible to the observer token document.
 * @param {TokenDocument} observer_token_doc
 * @param {object} options
 * @returns {{ ok: boolean, tokens: object[] }}
 */
export function get_visible_tokens(observer_token_doc, options = {}) {
	if (!canvas?.ready || !observer_token_doc) {
		return { ok: false, tokens: [] };
	}

	const observer = canvas.tokens.get(observer_token_doc.id);
	if (!observer) return { ok: false, tokens: [] };

	const scene = observer_token_doc.parent;
	if (!scene) return { ok: false, tokens: [] };

	const filter = options.filter || "all";
	const max_range = Number(options.max_range) || 0;
	const include_self = options.include_self ?? false;
	const exclude_hidden = options.exclude_hidden ?? true;
	const grid_size = scene.grid.size;

	let vision_source = create_observer_vision_source(observer);

	const results = [];
	try {
		for (const target_doc of scene.tokens) {
			if (!include_self && target_doc.id === observer_token_doc.id) continue;
			if (exclude_hidden && target_doc.hidden) continue;
			if (!_matches_filter(target_doc, filter)) continue;

			const distance_px_val = distance_px(observer_token_doc, target_doc);
			if (max_range > 0 && distance_px_val > max_range * grid_size) continue;

			const target = canvas.tokens.get(target_doc.id);
			if (!target) continue;

			if (!_can_observer_see_token(observer, target, vision_source)) continue;

			results.push(build_token_record(observer_token_doc, target_doc, grid_size));
		}
	} finally {
		vision_source?.destroy?.();
	}

	results.sort((a, b) => a.distance_px - b.distance_px);
	return { ok: true, tokens: results };
}

export function get_token_filter_options() {
	return { ...TOKEN_FILTER_OPTIONS };
}
