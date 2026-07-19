/**
 * light_condition.js — Light/darkness helpers for condition_light BT node.
 */

import { Status } from "./bt_engine.js";
import { _evaluate_operator } from "./utils.js";
import { get_flag_operator_options } from "./token_target.js";

const MODULE_PREFIX = "dc-npc-patrols.bt.nodes.condition_light";

const NUMERIC_MODES = ["scene_darkness", "campaign_darkness", "position_darkness"];
const BOOLEAN_MODES = ["in_light", "token_light"];

function L(key, fallback) {
	if (!game?.i18n) return fallback;
	const path = `${MODULE_PREFIX}.${key}`;
	const localized = game.i18n.localize(path);
	return localized !== path ? localized : fallback;
}

function _is_numeric_mode(mode) {
	return NUMERIC_MODES.includes(mode || "position_darkness");
}

function _token_point(bb) {
	if (!bb?.token) return null;
	return {
		x: bb.token.x,
		y: bb.token.y,
		elevation: bb.elevation ?? bb.token.elevation ?? 0,
	};
}

function _canvas_ready_for_scene(bb) {
	return !!canvas?.ready && canvas.scene?.id === bb?.scene?.id;
}

export function get_light_mode_options() {
	return {
		scene_darkness: L("mode.scene_darkness", "Scene Darkness"),
		campaign_darkness: L("mode.campaign_darkness", "Campaign Darkness"),
		position_darkness: L("mode.position_darkness", "Position Darkness"),
		in_light: L("mode.in_light", "In Light Source"),
		token_light: L("mode.token_light", "Token Emitting Light"),
	};
}

export function get_light_condition_fields() {
	return [
		{
			key: "mode",
			type: "dropdown",
			label: L("fields.mode", "Mode"),
			default: "position_darkness",
			options: get_light_mode_options(),
		},
		{
			key: "operator",
			type: "dropdown",
			label: L("fields.operator", "Operator"),
			default: "greater",
			options: get_flag_operator_options(),
			visible_if: (node) => _is_numeric_mode(node.mode),
		},
		{
			key: "threshold",
			type: "number",
			label: L("fields.threshold", "Threshold (0–1)"),
			default: 0.5,
			visible_if: (node) => _is_numeric_mode(node.mode),
		},
		{
			key: "match",
			type: "dropdown",
			label: L("fields.match", "Match Mode"),
			default: true,
			options: { true: "Matches", false: "Does Not Match" },
			visible_if: (node) => BOOLEAN_MODES.includes(node.mode),
		},
	];
}

export function populate_light_condition_fields(node, fields) {
	if (!_is_numeric_mode(node.mode)) return;
	for (const field of fields) {
		if (field.key === "operator") {
			field.options = get_flag_operator_options();
		}
	}
}

export function resolve_light_value(mode, bb) {
	const resolved_mode = mode || "position_darkness";

	switch (resolved_mode) {
		case "scene_darkness":
			return bb.scene_darkness ?? bb.scene?.environment?.darknessLevel ?? 0;
		case "campaign_darkness":
			if (bb.campaign_darkness != null) return bb.campaign_darkness;
			if (!game.dc?.utils?.time?.get_darkness_level) return undefined;
			return game.dc.utils.time.get_darkness_level(
				new Date(bb.current_unixtime ?? game.settings.get("Deadlands-Classic", "unixtime")),
				game.settings.get("Deadlands-Classic", "campaign_lat"),
				game.settings.get("Deadlands-Classic", "campaign_lng"),
			);
		case "position_darkness": {
			if (!_canvas_ready_for_scene(bb)) return undefined;
			const point = _token_point(bb);
			if (!point) return undefined;
			return canvas.effects.getDarknessLevel(point);
		}
		case "in_light": {
			if (!_canvas_ready_for_scene(bb)) return undefined;
			const point = _token_point(bb);
			if (!point) return undefined;
			return canvas.effects.testInsideLight(point);
		}
		case "token_light": {
			if (!bb.token) return undefined;
			const light = bb.token.light ?? {};
			return (light.bright ?? 0) > 0 || (light.dim ?? 0) > 0;
		}
		default:
			return undefined;
	}
}

export function tick_light_condition(node, bb) {
	const mode = node.mode || "position_darkness";
	const actual = resolve_light_value(mode, bb);
	if (actual === undefined) return Status.FAILURE;

	if (_is_numeric_mode(mode)) {
		const operator = node.operator || "greater";
		const threshold = node.threshold ?? 0.5;
		return _evaluate_operator(actual, operator, threshold)
			? Status.SUCCESS
			: Status.FAILURE;
	}

	const matches = actual === true;
	const want_match = node.match !== false;
	return (matches === want_match) ? Status.SUCCESS : Status.FAILURE;
}
