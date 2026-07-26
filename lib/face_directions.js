/**
 * face_directions.js — Compass directions for Action: Face and direction_select variables.
 */

import { _travel_rotation } from "./utils.js";

export const FACE_DIRECTION_OFFSETS = {
  N: { dx: 0, dy: -1 },
  NE: { dx: 1, dy: -1 },
  E: { dx: 1, dy: 0 },
  SE: { dx: 1, dy: 1 },
  S: { dx: 0, dy: 1 },
  SW: { dx: -1, dy: 1 },
  W: { dx: -1, dy: 0 },
  NW: { dx: -1, dy: -1 },
};

export const FACE_DIRECTION_IDS = Object.keys(FACE_DIRECTION_OFFSETS);

/** @returns {{ value: string, label: string }[]} */
export function get_face_direction_option_list() {
  return FACE_DIRECTION_IDS.map((id) => ({ value: id, label: id }));
}

/** @returns {Record<string, string>} */
export function get_face_direction_options() {
  return Object.fromEntries(FACE_DIRECTION_IDS.map((id) => [id, id]));
}

export function coerce_face_direction(raw, default_val = "S") {
  const empty = raw === undefined || raw === null || raw === "";
  const fallback = FACE_DIRECTION_IDS.includes(default_val) ? default_val : "S";
  if (empty) return fallback;
  const val = String(raw).trim().toUpperCase();
  return FACE_DIRECTION_IDS.includes(val) ? val : fallback;
}

/**
 * @param {TokenDocument} token_doc
 * @param {string} direction
 * @returns {number|null}
 */
export function rotation_for_face_direction(token_doc, direction) {
  const offset = FACE_DIRECTION_OFFSETS[direction];
  if (!offset) return null;
  const grid = token_doc.parent?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  const to_x = token_doc.x + offset.dx * grid;
  const to_y = token_doc.y + offset.dy * grid;
  return _travel_rotation(token_doc.x, token_doc.y, to_x, to_y);
}
