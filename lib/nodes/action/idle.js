/**
 * idle.js — Action: Idle
 *
 * Does nothing. Useful as a fallback in selectors.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("action_idle", {
		category: "action",
		label: "Action: Idle",
		icon: "fa-solid fa-circle",
		description: "Does nothing. Useful as a fallback in selectors.",
		tick: async () => Status.SUCCESS,
	});
}