/**
 * core_variable_types.js — Registers the built-in BT variable types.
 *
 * These replace the hardcoded VARIABLE_TYPES arrays and switch statements
 * that were previously in bt_editor.js, bt_io.js, and bt_variables.js.
 */

import { register_variable_type, VARIABLE_TYPE_REGISTRY } from "./variable_registry.js";
// Note: get_region_options, get_door_options remain in bt_variables.js
// and are passed via the options object at build_variable_field() call time.

export function register_core_variable_types() {
	register_variable_type({
		id: "text",
		label: "Text",
		default_value: () => "",
		coerce: (raw, default_val = "") => {
			const empty = raw === undefined || raw === null || raw === "";
			if (empty) {
				const fb_empty = default_val === undefined || default_val === null || default_val === "";
				return fb_empty ? "" : default_val;
			}
			return String(raw);
		},
		build_field: (def, raw, has_value, _options) => ({
			key: def.key,
			label: def.label || def.key,
			type: "text",
			default: def.default ?? "",
			value: has_value ? raw : "",
			display_value: has_value ? raw : (def.default ?? ""),
		}),
	});

	register_variable_type({
		id: "number",
		label: "Number",
		default_value: () => 0,
		coerce: (raw, default_val = "") => {
			const empty = raw === undefined || raw === null || raw === "";
			if (empty) {
				const fb_empty = default_val === undefined || default_val === null || default_val === "";
				if (fb_empty) return 0;
				const fb = Number(default_val);
				return Number.isNaN(fb) ? 0 : fb;
			}
			const n = Number(raw);
			if (Number.isNaN(n)) {
				const fb = Number(default_val);
				return Number.isNaN(fb) ? 0 : fb;
			}
			return n;
		},
		build_field: (def, raw, has_value, _options) => ({
			key: def.key,
			label: def.label || def.key,
			type: "number",
			default: def.default ?? "",
			value: has_value ? raw : "",
			display_value: has_value ? raw : (def.default ?? ""),
		}),
	});

	register_variable_type({
		id: "boolean",
		label: "Boolean",
		default_value: () => false,
		coerce: (raw, default_val = "") => {
			const empty = raw === undefined || raw === null || raw === "";
			if (empty) {
				const fb_empty = default_val === undefined || default_val === null || default_val === "";
				if (fb_empty) return false;
				return default_val === true || String(default_val).toLowerCase() === "true" || default_val === 1 || default_val === "1";
			}
			if (raw === true || raw === 1) return true;
			if (raw === false || raw === 0) return false;
			return String(raw).toLowerCase() === "true" || String(raw) === "1";
		},
		build_field: (def, raw, has_value, _options) => {
			const vtype = VARIABLE_TYPE_REGISTRY.boolean;
			const checked = vtype
				? vtype.coerce(has_value ? raw : def.default, def.default ?? "")
				: false;
			return {
				key: def.key,
				label: def.label || def.key,
				type: "boolean",
				default: def.default ?? "",
				value: has_value ? raw : "",
				display_value: has_value ? raw : (def.default ?? ""),
				checked,
			};
		},
	});

	register_variable_type({
		id: "region_select",
		label: "Region Select",
		default_value: () => "",
		coerce: (raw, default_val = "") => {
			const empty = raw === undefined || raw === null || raw === "";
			if (empty) {
				const fb_empty = default_val === undefined || default_val === null || default_val === "";
				return fb_empty ? "" : default_val;
			}
			return String(raw);
		},
		build_field: (def, raw, has_value, options = {}) => ({
			key: def.key,
			label: def.label || def.key,
			type: "region_select",
			default: def.default ?? "",
			value: has_value ? raw : "",
			display_value: has_value ? raw : (def.default ?? ""),
			options: options.region_options ?? [],
		}),
	});

	register_variable_type({
		id: "foundry_id",
		label: "Foundry ID",
		default_value: () => "",
		coerce: (raw, default_val = "") => {
			const empty = raw === undefined || raw === null || raw === "";
			if (empty) {
				const fb_empty = default_val === undefined || default_val === null || default_val === "";
				return fb_empty ? "" : default_val;
			}
			return String(raw);
		},
		build_field: (def, raw, has_value, options = {}) => ({
			key: def.key,
			label: def.label || def.key,
			type: "foundry_id",
			default: def.default ?? "",
			value: has_value ? raw : "",
			display_value: has_value ? raw : (def.default ?? ""),
			options: options.door_options ?? [],
		}),
	});

	register_variable_type({
		id: "fragment_select",
		label: "Fragment Select",
		default_value: () => "",
		coerce: (raw, default_val = "") => {
			const empty = raw === undefined || raw === null || raw === "";
			if (empty) {
				const fb_empty = default_val === undefined || default_val === null || default_val === "";
				return fb_empty ? "" : default_val;
			}
			return String(raw);
		},
		build_field: (def, raw, has_value, _options) => ({
			key: def.key,
			label: def.label || def.key,
			type: "fragment_select",
			default: def.default ?? "",
			value: has_value ? raw : "",
			display_value: has_value ? raw : (def.default ?? ""),
		}),
	});
}