/**
 * set_flag.js — Action: Set Flag
 *
 * Sets a flag on the NPC or target actor (BT-level, not boon-level).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("action_set_flag", {
		category: "action",
		label: "Action: Set Flag",
		icon: "fa-solid fa-flag",
		description: "Sets a flag on the NPC or target actor.",
		tick: async (node, bb) => {
			const actor = bb.actor;
			const scope = node.scope || 'dc-npc-patrols';
			const flag_path = node.flag_path || 'quest_flags';
			if (!node.flag_key) return Status.FAILURE;
			await actor.setFlag(scope, `${flag_path}.${node.flag_key}`, node.flag_value ?? true);
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "scope",      type: "text", label: "Scope",      default: "dc-npc-patrols" },
				{ key: "flag_path",   type: "text", label: "Flag Path",  default: "quest_flags" },
				{ key: "flag_key",    type: "text", label: "Flag Key",   default: "" },
				{ key: "flag_value",  type: "text", label: "Flag Value", default: "true" },
			],
		},
	});
}