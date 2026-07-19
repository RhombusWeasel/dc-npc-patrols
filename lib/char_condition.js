/**
 * char_condition.js — Character condition helpers for condition_character BT node.
 */

import { evaluate, resolve_value } from "../../../systems/Deadlands-Classic/module/lib/condition_eval.js";
import { Status } from "./bt_engine.js";
import { get_equip_slot_options, resolve_actor } from "./gear_actions.js";
import { get_flag_operator_options } from "./token_target.js";

const MODULE_PREFIX = "dc-npc-patrols.bt.nodes.condition_character";

function L(key, fallback) {
	if (!game?.i18n) return fallback;
	const path = `${MODULE_PREFIX}.${key}`;
	const localized = game.i18n.localize(path);
	return localized !== path ? localized : fallback;
}

function _localize_options(source, translation_path) {
	const opts = {};
	if (!source) return opts;
	for (const key of Object.keys(source)) {
		let label = source[key]?.label ?? key;
		if (game?.i18n) {
			const path = `${translation_path}.${key}`;
			const localized = game.i18n.localize(path);
			if (localized !== path) label = localized;
		}
		opts[key] = label;
	}
	return opts;
}

export function get_check_type_options() {
	return {
		pool: L("check_type.pool", "Pool"),
		trait: L("check_type.trait", "Trait"),
		skill: L("check_type.skill", "Skill"),
		gear: L("check_type.gear", "Gear Count"),
		flag: L("check_type.flag", "Flag"),
		edge: L("check_type.edge", "Edge / Hindrance"),
		equipped: L("check_type.equipped", "Equipped Item"),
		status: L("check_type.status", "Status Effect"),
		scalar: L("check_type.scalar", "Scalar Stat"),
	};
}

export function get_pool_options() {
	return _localize_options(game.dc?.system?.pools, "dc.pools");
}

export function get_skill_options() {
	return _localize_options(game.dc?.system?.skills, "dc.skills");
}

export function get_trait_options() {
	return _localize_options(game.dc?.system?.char?.attributes, "dc.attributes");
}

export function get_edge_options() {
	const edges = game.dc?.system?.edges ?? {};
	const opts = {};
	for (const key of Object.keys(edges)) {
		const edge = edges[key];
		const label = edge?.label ?? key;
		opts[key] = label;
	}
	return opts;
}

export function get_status_options() {
	return _localize_options(game.dc?.system?.statuses, "dc.statuses");
}

export function get_scalar_field_options() {
	const fields = game.dc?.system?.mod_value_fields ?? {};
	const opts = {};
	for (const [key, label] of Object.entries(fields)) {
		opts[key] = label ?? key;
	}
	return opts;
}

export function get_edge_kind_options() {
	return {
		any: L("edge_kind.any", "Any"),
		edge: L("edge_kind.edge", "Edge"),
		hindrance: L("edge_kind.hindrance", "Hindrance"),
	};
}

export function get_equip_mode_options() {
	return {
		slot: L("equip_mode.slot", "By Slot"),
		label: L("equip_mode.label", "By Item Label"),
	};
}

export function get_character_operator_options(check_type) {
	if (check_type === "pool") {
		return {
			...get_flag_operator_options(),
			empty: L("operator.empty", "Empty"),
			full: L("operator.full", "Full"),
		};
	}
	if (check_type === "edge" || check_type === "equipped" || check_type === "status") {
		return {
			exists: "Exists",
			not_exists: "Does Not Exist",
		};
	}
	return get_flag_operator_options();
}

export function is_character_field_visible(node, field) {
	if (typeof field.visible_if === "function") {
		return field.visible_if(node);
	}
	if (field.condition) {
		if (node[field.condition.field] != field.condition.value) return false;
	}
	if (field.requires) {
		for (const req of field.requires) {
			if (node[req.field] != req.value) return false;
		}
	}
	return true;
}

export function get_character_condition_fields() {
	return [
		{
			key: "check_type",
			type: "dropdown",
			label: L("fields.check_type", "Check Type"),
			default: "pool",
			options: get_check_type_options(),
		},
		{
			key: "pool",
			type: "dropdown",
			label: L("fields.pool", "Pool"),
			default: "wind",
			options: {},
			condition: { field: "check_type", value: "pool" },
		},
		{
			key: "trait_key",
			type: "dropdown",
			label: L("fields.trait_key", "Trait"),
			default: "cognition",
			options: {},
			condition: { field: "check_type", value: "trait" },
		},
		{
			key: "skill_key",
			type: "dropdown",
			label: L("fields.skill_key", "Skill"),
			default: "academia",
			options: {},
			condition: { field: "check_type", value: "skill" },
		},
		{
			key: "item_label",
			type: "text",
			label: L("fields.item_label", "Item Label"),
			default: "",
			visible_if: (node) => node.check_type === "gear"
				|| (node.check_type === "equipped" && node.equip_mode === "label"),
		},
		{
			key: "scope",
			type: "text",
			label: L("fields.scope", "Flag Scope"),
			default: "dc-npc-patrols",
			condition: { field: "check_type", value: "flag" },
		},
		{
			key: "flag_path",
			type: "text",
			label: L("fields.flag_path", "Flag Path"),
			default: "quest_flags",
			condition: { field: "check_type", value: "flag" },
		},
		{
			key: "flag_key",
			type: "text",
			label: L("fields.flag_key", "Flag Key"),
			default: "",
			condition: { field: "check_type", value: "flag" },
		},
		{
			key: "edge_key",
			type: "dropdown",
			label: L("fields.edge_key", "Edge"),
			default: "",
			options: {},
			condition: { field: "check_type", value: "edge" },
		},
		{
			key: "edge_kind",
			type: "dropdown",
			label: L("fields.edge_kind", "Edge Kind"),
			default: "any",
			options: get_edge_kind_options(),
			condition: { field: "check_type", value: "edge" },
		},
		{
			key: "equip_mode",
			type: "dropdown",
			label: L("fields.equip_mode", "Match By"),
			default: "slot",
			options: get_equip_mode_options(),
			condition: { field: "check_type", value: "equipped" },
		},
		{
			key: "equip_slot",
			type: "dropdown",
			label: L("fields.equip_slot", "Equip Slot"),
			default: "main_hand",
			options: {},
			condition: { field: "check_type", value: "equipped" },
			requires: [{ field: "equip_mode", value: "slot" }],
		},
		{
			key: "status_key",
			type: "dropdown",
			label: L("fields.status_key", "Status"),
			default: "",
			options: {},
			condition: { field: "check_type", value: "status" },
		},
		{
			key: "scalar_field",
			type: "dropdown",
			label: L("fields.scalar_field", "Stat Field"),
			default: "pace",
			options: {},
			condition: { field: "check_type", value: "scalar" },
		},
		{
			key: "operator",
			type: "dropdown",
			label: L("fields.operator", "Operator"),
			default: "less_eq",
			options: get_flag_operator_options(),
		},
		{
			key: "expected_value",
			type: "text",
			label: L("fields.expected_value", "Expected Value"),
			default: "0",
			visible_if: (node) => !["edge", "equipped", "status"].includes(node.check_type),
		},
	];
}

export function populate_character_condition_fields(node, fields) {
	const check_type = node.check_type || "pool";
	for (const field of fields) {
		if (field.key === "pool") field.options = get_pool_options();
		if (field.key === "skill_key") field.options = get_skill_options();
		if (field.key === "trait_key") field.options = get_trait_options();
		if (field.key === "edge_key") field.options = get_edge_options();
		if (field.key === "status_key") field.options = get_status_options();
		if (field.key === "scalar_field") field.options = get_scalar_field_options();
		if (field.key === "equip_slot") field.options = get_equip_slot_options();
		if (field.key === "operator") field.options = get_character_operator_options(check_type);
	}
}

export function filter_character_condition_fields(node, fields) {
	return fields.filter((field) => is_character_field_visible(node, field));
}

export function tick_character_condition(node, bb) {
	const actor = resolve_actor(bb.actor);
	if (!actor) return Status.FAILURE;

	const check_type = node.check_type || "pool";
	let operator = node.operator;
	if (!operator) {
		operator = (check_type === "edge" || check_type === "equipped" || check_type === "status")
			? "exists"
			: "less_eq";
	}

	const actual = resolve_value(actor, node);
	if (actual === undefined) return Status.FAILURE;

	const expected = node.expected_value;
	return evaluate(actual, operator, expected) ? Status.SUCCESS : Status.FAILURE;
}
