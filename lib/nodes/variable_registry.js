/**
 * variable_registry.js — Variable type registry for BT template variables.
 *
 * Each variable type provides:
 *   id           — unique type string (e.g. 'region_select')
 *   label        — display label for dropdowns
 *   default_value()       — typed default for new variables of this type
 *   coerce(raw, default_val) — type coercion function
 *   build_field(def, raw, has_value, options) — produce field object for actor sheet UI
 *
 * Core types are registered in loader.js.  External modules can register
 * additional types via the module API:
 *   game.modules.get('dc-npc-patrols').api.register_variable_type(def)
 */

export const VARIABLE_TYPE_REGISTRY = {};

export function register_variable_type(def) {
	if (!def?.id) return;
	VARIABLE_TYPE_REGISTRY[def.id] = def;
}

export function get_variable_type(id) {
	return VARIABLE_TYPE_REGISTRY[id] ?? null;
}

export function get_all_variable_types() {
	return VARIABLE_TYPE_REGISTRY;
}

/** Returns array of { id, label } for dropdown population. */
export function get_variable_type_options() {
	return Object.values(VARIABLE_TYPE_REGISTRY).map((t) => ({
		id: t.id,
		label: t.label || t.id,
	}));
}

/** Coerce a value using a registered type, falling back to text behaviour. */
export function coerce_variable_value(val, type, default_val = "") {
	const vtype = VARIABLE_TYPE_REGISTRY[type];
	if (vtype?.coerce) return vtype.coerce(val, default_val);
	// Fallback: text-like coercion
	const empty = val === undefined || val === null || val === "";
	if (empty) {
		const fb_empty = default_val === undefined || default_val === null || default_val === "";
		return fb_empty ? "" : default_val;
	}
	return String(val);
}

/** Typed default for a variable type. */
export function typed_default(type) {
	const vtype = VARIABLE_TYPE_REGISTRY[type];
	if (vtype?.default_value) return vtype.default_value();
	return "";
}

/** Build the actor-sheet field object for a variable definition. */
export function build_variable_field(def, raw, has_value, options = {}) {
	const type = def.type || "text";
	const vtype = VARIABLE_TYPE_REGISTRY[type];
	if (vtype?.build_field) {
		return vtype.build_field(def, raw, has_value, options);
	}
	// Fallback: plain text field
	return {
		key: def.key,
		label: def.label || def.key,
		type: "text",
		default: def.default ?? "",
		value: has_value ? raw : "",
		display_value: has_value ? raw : (def.default ?? ""),
	};
}