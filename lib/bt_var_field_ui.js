/**
 * bt_var_field_ui.js — Typed default/expected fields for BT variable UI.
 */

import { typed_default, coerce_variable_value } from "./nodes/variable_registry.js";
import {
  get_region_options,
  get_door_options,
  get_dialog_tree_options,
  get_ambient_set_options,
} from "./bt_variables.js";
import { get_fragment_options } from "./bt_variables.js";

const SELECT_VAR_TYPES = new Set([
  "direction_select",
  "region_select",
  "foundry_id",
  "dialog_tree_select",
  "ambient_set_select",
  "fragment_select",
]);

/** @returns {{ value: string, label: string }[]} */
export function get_var_editor_options(type) {
  switch (type) {
    case "direction_select":
      return get_face_direction_option_list();
    case "region_select":
      return get_region_options();
    case "foundry_id":
      return get_door_options();
    case "dialog_tree_select":
      return get_dialog_tree_options();
    case "ambient_set_select":
      return get_ambient_set_options();
    case "fragment_select":
      return get_fragment_options();
    default:
      return [];
  }
}

export function is_select_var_type(type) {
  return SELECT_VAR_TYPES.has(type);
}

export function normalize_var_key(key) {
  return String(key || "")
    .trim()
    .replace(/^\{\{(.+)\}\}$/, "$1")
    .trim();
}

/** @param {object[]} var_defs @param {string} key */
export function lookup_var_def(var_defs, key) {
  const normalized = normalize_var_key(key);
  if (!normalized) return null;
  return var_defs.find((d) => d.key === normalized) ?? null;
}

export function default_for_var_type(type) {
  return typed_default(type || "text");
}

export function coerce_var_default_on_type_change(var_def, new_type) {
  return coerce_variable_value(var_def.default, new_type, typed_default(new_type));
}

/**
 * @param {object} var_def
 * @param {(s: string) => string} escape
 */
export function render_var_default_field_html(var_def, escape) {
  const type = var_def.type || "text";
  const val = var_def.default;

  if (type === "boolean") {
    const checked = val === true || val === "true" || val === 1 || val === "1";
    return `<input type="checkbox" data-var-field="default" data-var-default-type="boolean"${checked ? " checked" : ""} />`;
  }

  if (type === "number") {
    const display = val === undefined || val === null || val === "" ? "" : String(val);
    return `<input type="number" data-var-field="default" data-var-default-type="number" value="${escape(display)}" placeholder="0" />`;
  }

  if (is_select_var_type(type)) {
    return `<select data-var-field="default" data-var-default-type="${escape(type)}"><option value="">${escape("(blank)")}</option></select>`;
  }

  const display = val === undefined || val === null ? "" : String(val);
  return `<input type="text" data-var-field="default" data-var-default-type="text" value="${escape(display)}" placeholder="${escape("(blank)")}" />`;
}

export function read_var_default_from_element(el, type) {
  if (type === "boolean") return el.checked;
  if (type === "number") {
    if (el.value === "") return "";
    const n = Number(el.value);
    return Number.isNaN(n) ? "" : n;
  }
  return el.value;
}

/**
 * @param {HTMLSelectElement} sel
 * @param {{ value: string, label: string }[]} options
 * @param {string} current_value
 * @param {{ blank_label?: string }} [opts]
 */
export function populate_select_element(sel, options, current_value, opts = {}) {
  const escape = foundry.utils.escapeHTML;
  const blank = opts.blank_label ?? "";
  let inner = blank ? `<option value="">${escape(blank)}</option>` : "";
  for (const opt of options) {
    inner += `<option value="${escape(opt.value)}">${escape(opt.label)}</option>`;
  }
  sel.innerHTML = inner;
  if (current_value !== undefined && current_value !== null && current_value !== "") {
    sel.value = String(current_value);
  }
}

/** Map a variable def type to a node editor field descriptor. */
function _field_for_var_type(var_def) {
  const type = var_def?.type || "text";
  if (type === "boolean") return { type: "boolean" };
  if (type === "number") return { type: "number" };
  if (is_select_var_type(type)) {
    return {
      type,
      options: Object.fromEntries(
        get_var_editor_options(type).map((o) => [o.value, o.label])
      ),
    };
  }
  return { type: "text" };
}

/**
 * Adjust condition_variable node fields from declared tree variables.
 * @param {object} node
 * @param {object[]} fields
 * @param {object[]} var_defs
 */
export function populate_variable_condition_fields(node, fields, var_defs = []) {
  const declared = var_defs.filter((d) => d.key);

  const key_field = fields.find((f) => f.key === "variable_key");
  if (key_field && declared.length) {
    key_field.type = "dropdown";
    key_field.options = Object.fromEntries(
      declared.map((d) => [d.key, d.label || d.key])
    );
  }

  const expected_field = fields.find((f) => f.key === "expected_value");
  if (!expected_field) return;

  const var_def = lookup_var_def(declared, node.variable_key);
  if (!var_def) {
    expected_field.type = "text";
    delete expected_field.options;
    return;
  }

  Object.assign(expected_field, _field_for_var_type(var_def));
}

/**
 * Coerce condition expected_value to match resolved variable type at tick time.
 * @param {*} actual
 * @param {*} expected
 */
export function coerce_condition_expected(actual, expected) {
  if (typeof actual === "boolean") {
    return expected === true
      || String(expected).toLowerCase() === "true"
      || expected === 1
      || expected === "1";
  }
  if (typeof actual === "number") {
    const n = Number(expected);
    return Number.isNaN(n) ? expected : n;
  }
  return expected;
}
