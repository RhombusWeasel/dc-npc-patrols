/**
 * face_target.js — Action: Face Target
 *
 * Rotates toward a blackboard target or the nearest matching token within range.
 */

import { register_node } from "../registry.js";
import { FACE_TOKEN_EDITOR_FIELDS, _tick_face_token } from "./_face_token.js";

export function register() {
	register_node("action_face_target", {
		category: "action",
		label: "Action: Face Target",
		icon: "fa-solid fa-bullseye",
		description: "Rotates toward a blackboard target or the nearest matching token within range.",
		tick: _tick_face_token,
		editor: {
			fields: FACE_TOKEN_EDITOR_FIELDS,
		},
	});
}