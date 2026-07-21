/**
 * face_token.js — Shared face-token logic for face_player and face_target.
 *
 * Rotates toward a blackboard target or nearest matching token.
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

export const FACE_TOKEN_EDITOR_FIELDS = [
	{ key: "source", type: "dropdown", label: "Source", default: "blackboard",
		options: get_target_source_options(),
	},
	{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
	{ key: "blackboard_key", type: "text", label: "List Blackboard Key", default: "visible_tokens" },
	{ key: "filter", type: "dropdown", label: "Filter", default: "all",
		options: get_token_filter_options(),
	},
	{ key: "actor_type", type: "dropdown", label: "Actor Type", default: "any",
		options: get_actor_type_options(),
	},
	{ key: "disposition", type: "dropdown", label: "Disposition", default: "any",
		options: get_disposition_options(),
	},
	{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0 },
	{ key: "name_contains", type: "text", label: "Name Contains", default: "" },
	{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true },
];

export async function _tick_face_token(node, bb) {
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