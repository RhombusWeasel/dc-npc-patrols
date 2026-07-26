/**
 * face_token.js — Shared face-token logic for face_player and face_target.
 *
 * Rotates toward a blackboard target, nearest matching token, or a fixed compass direction.
 */

import { Status } from "../../bt_engine.js";
import { warn_combat_once } from "../../bt_combat_log.js";
import { _travel_rotation } from "../../utils.js";
import {
	resolve_face_token_doc,
	normalize_face_node,
	get_target_source_options,
	get_actor_type_options,
	get_disposition_options,
} from "../../token_target.js";
import { get_token_filter_options } from "../../token_vision.js";

const FACE_DIRECTION_OFFSETS = {
	N: { dx: 0, dy: -1 },
	NE: { dx: 1, dy: -1 },
	E: { dx: 1, dy: 0 },
	SE: { dx: 1, dy: 1 },
	S: { dx: 0, dy: 1 },
	SW: { dx: -1, dy: 1 },
	W: { dx: -1, dy: 0 },
	NW: { dx: -1, dy: -1 },
};

export function get_face_direction_options() {
	return {
		N: "N",
		NE: "NE",
		E: "E",
		SE: "SE",
		S: "S",
		SW: "SW",
		W: "W",
		NW: "NW",
	};
}

function _rotation_for_direction(token_doc, direction) {
	const offset = FACE_DIRECTION_OFFSETS[direction];
	if (!offset) return null;
	const grid = token_doc.parent?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
	const to_x = token_doc.x + offset.dx * grid;
	const to_y = token_doc.y + offset.dy * grid;
	return _travel_rotation(token_doc.x, token_doc.y, to_x, to_y);
}

const _TARGET_FIELDS_HIDDEN = { field: "face_direction", value: false };

export const FACE_TOKEN_EDITOR_FIELDS = [
	{ key: "face_direction", type: "boolean", label: "Face Fixed Direction", default: false },
	{ key: "direction", type: "dropdown", label: "Direction", default: "S",
		options: get_face_direction_options(),
		condition: { field: "face_direction", value: true },
	},
	{ key: "source", type: "dropdown", label: "Source", default: "blackboard",
		options: get_target_source_options(),
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target",
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "blackboard_key", type: "text", label: "List Blackboard Key", default: "visible_tokens",
		condition: _TARGET_FIELDS_HIDDEN,
		requires: [{ field: "source", value: "blackboard_list" }],
	},
	{ key: "filter", type: "dropdown", label: "Filter", default: "all",
		options: get_token_filter_options(),
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "actor_type", type: "dropdown", label: "Actor Type", default: "any",
		options: get_actor_type_options(),
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "disposition", type: "dropdown", label: "Disposition", default: "any",
		options: get_disposition_options(),
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0,
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "name_contains", type: "text", label: "Name Contains", default: "",
		condition: _TARGET_FIELDS_HIDDEN,
	},
	{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true,
		condition: _TARGET_FIELDS_HIDDEN,
	},
];

export async function _tick_face_token(node, bb) {
	if (!bb?.token) return Status.FAILURE;

	if (node.face_direction) {
		const rotation = _rotation_for_direction(bb.token, node.direction || "S");
		if (rotation == null) return Status.FAILURE;
		await bb.token.update({ rotation }, { animate: true });
		return Status.SUCCESS;
	}

	const target_doc = resolve_face_token_doc(bb, normalize_face_node(node));
	if (!target_doc) {
		warn_combat_once(bb, "face_target", "no matching token to face");
		return Status.FAILURE;
	}

	const rotation = _travel_rotation(bb.token.x, bb.token.y, target_doc.x, target_doc.y);
	if (rotation == null) return Status.FAILURE;
	await bb.token.update({ rotation }, { animate: true });
	return Status.SUCCESS;
}