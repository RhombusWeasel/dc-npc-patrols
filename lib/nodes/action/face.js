/**
 * face.js — Action: Face
 *
 * Rotates toward a blackboard target, the nearest matching token within range,
 * or a fixed compass direction.
 * Replaces the legacy face_player and face_target nodes.
 */

import { register_node } from "../registry.js";
import { FACE_TOKEN_EDITOR_FIELDS, _tick_face_token } from "./_face_token.js";

export function register() {
	register_node("action_face", {
		category: "action",
		label: "Action: Face",
		icon: "fa-solid fa-bullseye",
		description: "Rotates toward a target token or a fixed compass direction (N, NE, E, etc.).",
		tick: _tick_face_token,
		editor: {
			fields: FACE_TOKEN_EDITOR_FIELDS,
		},
	});
}