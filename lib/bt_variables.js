/**
 * bt_variables.js — BT template variable resolve, coerce, and UI helpers.
 */

import { get_cached_variable_defs } from "./bt_var_def_cache.js";
import { resolve_actor_for_token } from "./token_actor.js";
import {
	coerce_variable_value,
	build_variable_field,
} from "./nodes/variable_registry.js";
import { get_trees, get_ambient_sets } from "./dialog_tree_store.js";
import { list_fragments } from "./bt_subtree.js";
import { get_bts } from "./bt_store.js";

const MODULE_ID = "dc-npc-patrols";

// Re-export for backward compatibility — existing consumers import
// coerce_variable_value from bt_variables.js.
export { coerce_variable_value };

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

/** World dialog trees for dialog_tree_select variables. */
export function get_dialog_tree_options() {
	return Object.values(get_trees())
		.map((t) => ({ value: t.id, label: t.name || t.id }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** World ambient sets for ambient_set_select variables. */
export function get_ambient_set_options() {
	return Object.values(get_ambient_sets())
		.map((s) => ({ value: s.id, label: s.name || s.id }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** BT fragments for fragment_select variables. */
export function get_fragment_options() {
	return list_fragments(get_bts())
		.map((f) => ({ value: f.id, label: f.name || f.id }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

export function resolve_variables_for_defs(actor, var_defs = []) {
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

export function resolve_actor_variables(actor, bt_id) {
	const var_defs = bt_id ? get_cached_variable_defs(bt_id) : [];
	return resolve_variables_for_defs(actor, var_defs);
}

export function build_variable_fields(actor, bt_id) {
	const var_defs = bt_id ? get_cached_variable_defs(bt_id) : [];
	if (!var_defs.length) return [];

	const actor_vars = actor?.getFlag(MODULE_ID, "bt_variables") || {};
	const options = {
		region_options: get_region_options(),
		door_options: get_door_options(),
		dialog_tree_options: get_dialog_tree_options(),
		ambient_set_options: get_ambient_set_options(),
		fragment_options: get_fragment_options(),
	};

	return var_defs.filter((d) => d.key).map((def) => {
		const raw = actor_vars[def.key];
		const has_value = raw !== undefined && raw !== "";
		return build_variable_field(def, raw, has_value, options);
	});
}

export function resolve_actor_for_flags(actor, token_doc = null) {
	return resolve_actor_for_token(token_doc, actor);
}

export async function save_actor_variable(actor, key, raw_value, type, token_doc = null) {
	actor = resolve_actor_for_flags(actor, token_doc);
	if (!actor || !key) return;
	const vars = { ...(actor.getFlag(MODULE_ID, "bt_variables") || {}) };
	if (raw_value === "" || raw_value === null || raw_value === undefined) {
		delete vars[key];
	} else if (type === "boolean") {
		vars[key] = raw_value === true || raw_value === "true" || raw_value === 1 || raw_value === "1";
	} else {
		vars[key] = raw_value;
	}
	// Write the WHOLE module flags object with recursive:false so keys removed
	// from bt_variables (e.g. "use default" clearing an override) are actually
	// dropped from the DB. A plain nested update() merge retains keys absent
	// from the payload, so delete vars[key] above would otherwise be a no-op
	// and the old value would reload on the next sheet open.
	const module_flags = foundry.utils.deepClone(actor.getFlag(MODULE_ID)) || {};
	module_flags.bt_variables = foundry.utils.deepClone(vars);
	await actor.update(
		{ flags: { [MODULE_ID]: module_flags } },
		{ render: false, recursive: false }
	);
}

export function wire_bt_variable_events(html, actor, bt_id, token_doc = null) {
	actor = resolve_actor_for_flags(actor, token_doc);
	if (!html || !actor || !bt_id) return;

	const var_defs = bt_id ? get_cached_variable_defs(bt_id) : [];
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
			await save_actor_variable(actor, key, val, def.type || "text", token_doc);
		});
	});
}
