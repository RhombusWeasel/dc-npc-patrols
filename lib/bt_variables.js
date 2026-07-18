/**
 * bt_variables.js — BT template variable resolve, coerce, and UI helpers.
 */

import { get_bt } from "./bt_store.js";

const MODULE_ID = "dc-npc-patrols";

function _typed_default(type) {
	switch (type) {
		case "number": return 0;
		case "boolean": return false;
		default: return "";
	}
}

export function coerce_variable_value(val, type, default_val = "") {
	const empty = val === undefined || val === null || val === "";
	if (empty) {
		const fb_empty = default_val === undefined || default_val === null || default_val === "";
		val = fb_empty ? _typed_default(type) : default_val;
	}

	switch (type) {
		case "number": {
			const n = Number(val);
			if (Number.isNaN(n)) {
				const fb = Number(default_val);
				return Number.isNaN(fb) ? 0 : fb;
			}
			return n;
		}
		case "boolean":
			if (val === true || val === 1) return true;
			if (val === false || val === 0) return false;
			return String(val).toLowerCase() === "true" || String(val) === "1";
		case "waypoint_select":
		case "region_select":
		case "foundry_id":
		case "text":
		default:
			return String(val);
	}
}

export function get_waypoint_options(actor) {
	const paths = actor?.getFlag(MODULE_ID, "paths") || [];
	const enabled = [];
	const disabled = [];
	const seen = new Set();

	for (const path of paths) {
		const bucket = path.enabled ? enabled : disabled;
		for (const wp of path.waypoints || []) {
			const label = (wp.label || "").trim();
			if (!label || seen.has(label)) continue;
			seen.add(label);
			bucket.push({ value: label, label });
		}
	}
	return [...enabled, ...disabled];
}

/** Scene region names for region_select variables (matches BT move_to_region nodes). */
export function get_region_options(scene = canvas?.scene) {
	if (!scene?.regions) return [];
	const options = [];
	const seen = new Set();
	for (const region of scene.regions) {
		const name = (region.name || "").trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		options.push({ value: name, label: name });
	}
	return options.sort((a, b) => a.label.localeCompare(b.label));
}

/** Scene door walls for foundry_id variables and door interact nodes. */
export function get_door_options(scene = canvas?.scene) {
	if (!scene?.walls) return [];
	const grid = scene.grid.size;
	const options = [];
	for (const wall of scene.walls) {
		if (wall.door <= CONST.WALL_DOOR_TYPES.NONE) continue;
		const c = wall.c;
		if (!c || c.length < 4) continue;
		const gx = Math.floor(((c[0] + c[2]) / 2) / grid);
		const gy = Math.floor(((c[1] + c[3]) / 2) / grid);
		const kind = wall.door === CONST.WALL_DOOR_TYPES.SECRET ? "Secret" : "Door";
		options.push({ value: wall.id, label: `${kind} (${gx}, ${gy})` });
	}
	return options.sort((a, b) => a.label.localeCompare(b.label));
}

export function resolve_actor_variables(actor, bt_id) {
	const tree = bt_id ? get_bt(bt_id) : null;
	const var_defs = tree?.variables || [];
	const actor_vars = actor?.getFlag(MODULE_ID, "bt_variables") || {};
	const resolved = {};

	for (const def of var_defs) {
		const key = def.key;
		if (!key) continue;
		const raw = actor_vars[key];
		const has_override = raw !== undefined && raw !== "";
		const source = has_override ? raw : (def.default ?? "");
		resolved[key] = coerce_variable_value(source, def.type || "text", def.default ?? "");
	}
	return resolved;
}

export function build_variable_fields(actor, bt_id) {
	const tree = bt_id ? get_bt(bt_id) : null;
	const var_defs = tree?.variables || [];
	if (!var_defs.length) return [];

	const actor_vars = actor?.getFlag(MODULE_ID, "bt_variables") || {};
	const waypoint_options = get_waypoint_options(actor);
	const region_options = get_region_options();
	const door_options = get_door_options();

	return var_defs.filter((d) => d.key).map((def) => {
		const raw = actor_vars[def.key];
		const has_value = raw !== undefined && raw !== "";
		const field = {
			key: def.key,
			label: def.label || def.key,
			type: def.type || "text",
			default: def.default ?? "",
			value: has_value ? raw : "",
			display_value: has_value ? raw : (def.default ?? ""),
		};
		if (field.type === "waypoint_select") {
			field.options = waypoint_options;
		}
		if (field.type === "region_select") {
			field.options = region_options;
		}
		if (field.type === "foundry_id") {
			field.options = door_options;
		}
		if (field.type === "boolean") {
			field.checked = coerce_variable_value(
				has_value ? raw : def.default,
				"boolean",
				def.default
			);
		}
		return field;
	});
}

export function resolve_actor_for_flags(actor) {
	if (!actor) return null;
	if (!actor.isToken) return game.actors.get(actor.id) ?? actor;
	return actor;
}

export async function save_actor_variable(actor, key, raw_value, type) {
	actor = resolve_actor_for_flags(actor);
	if (!actor || !key) return;
	const vars = { ...(actor.getFlag(MODULE_ID, "bt_variables") || {}) };
	if (raw_value === "" || raw_value === null || raw_value === undefined) {
		delete vars[key];
	} else if (type === "boolean") {
		vars[key] = raw_value === true || raw_value === "true" || raw_value === 1 || raw_value === "1";
	} else {
		vars[key] = raw_value;
	}
	await actor.update(
		{ flags: { [MODULE_ID]: { bt_variables: foundry.utils.deepClone(vars) } } },
		{ render: false }
	);
}

export function wire_bt_variable_events(html, actor, bt_id) {
	actor = resolve_actor_for_flags(actor);
	if (!html || !actor || !bt_id) return;

	const tree = get_bt(bt_id);
	const var_defs = tree?.variables || [];
	const def_by_key = Object.fromEntries(var_defs.filter((d) => d.key).map((d) => [d.key, d]));

	html.querySelectorAll("[data-bt-var]").forEach((el) => {
		el.addEventListener("change", async () => {
			const key = el.dataset.btVar;
			const def = def_by_key[key];
			if (!def) return;
			let val;
			if (def.type === "boolean") {
				val = el.checked;
			} else {
				val = el.value;
			}
			await save_actor_variable(actor, key, val, def.type || "text");
		});
	});
}
