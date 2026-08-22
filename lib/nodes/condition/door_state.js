/**
 * door_state.js — Condition: Door State
 *
 * Checks the current state of a door wall (open, closed, or locked).
 * Lets trees gate door actions on the door's ACTUAL runtime state, so an
 * "open if locked" / "lock if open" shopkeeper fragment only acts when the
 * door is genuinely in the wrong state — no separate bool to desync.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { _has_unresolved_variables } from "../../utils.js";
import { resolve_wall, door_state_from_key } from "../../doors.js";

const DOOR_STATES = { open: "Open", closed: "Closed", locked: "Locked" };

export function register() {
	register_node("condition_door_state", {
		category: "condition",
		label: "Condition: Door State",
		icon: "fa-solid fa-door-closed",
		description: "Checks whether a door wall is currently open, closed, or locked. Gate door actions on the real state.",
		tick: async (node, bb, engine) => {
			const wall_id = (node.wall_id || "").trim();
			if (!wall_id || _has_unresolved_variables(wall_id)) return Status.FAILURE;

			const expected = door_state_from_key(node.state || "closed");
			const mode = node.match === false ? "not" : "is";

			const wall = await resolve_wall(bb.scene, wall_id);
			if (!wall) return Status.FAILURE;

			const matches = wall.ds === expected;
			return (mode === "is" ? matches : !matches) ? Status.SUCCESS : Status.FAILURE;
		},
		editor: {
			fields: [
				{ key: "wall_id", type: "foundry_id", label: "Door Wall ID", default: "" },
				{
					key: "state",
					type: "dropdown",
					label: "Expected State",
					default: "closed",
					options: DOOR_STATES,
				},
				{
					key: "match",
					type: "dropdown",
					label: "Match Mode",
					default: true,
					options: [
						{ value: true, label: "Matches" },
						{ value: false, label: "Does Not Match" },
					],
				},
			],
		},
	});
}
