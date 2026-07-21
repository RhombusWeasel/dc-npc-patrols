/**
 * face_player.js — Action: Face Token (legacy)
 *
 * Rotates toward a blackboard target or the nearest matching token.
 * Legacy node type; prefer action_face_target. Defaults to nearest player.
 */

import { register_node } from "../registry.js";
import { FACE_TOKEN_EDITOR_FIELDS, _tick_face_token } from "./_face_token.js";

export function register() {
	register_node("action_face_player", {
		category: "action",
		label: "Action: Face Token",
		icon: "fa-solid fa-eye",
		description: "Rotates toward a blackboard target or the nearest matching token. Legacy node type; prefer Action: Face Target.",
		tick: _tick_face_token,
		editor: {
			fields: [
				...FACE_TOKEN_EDITOR_FIELDS.map((field) => ({
					...field,
					default: field.key === "source" ? "scene_scan"
						: field.key === "filter" ? "players"
						: field.key === "max_range" ? 3
						: field.default,
				})),
			],
		},
	});
}