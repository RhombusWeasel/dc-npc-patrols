/**
 * succeed.js — Action: Succeed
 *
 * Does nothing and returns SUCCESS. Useful as a fallback in selectors
 * to prevent fall-through to more aggressive branches.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("action_succeed", {
		category: "action",
		label: "Action: Succeed",
		icon: "fa-solid fa-circle-check",
		description: "Does nothing and returns SUCCESS. Useful as a fallback in selectors.",
		tick: async () => Status.SUCCESS,
	});
}