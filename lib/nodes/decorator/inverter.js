/**
 * inverter.js — Decorator: Inverter (NOT)
 *
 * Inverts child result: success↔failure, running stays running.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";

export function register() {
	register_node("inverter", {
		category: "decorator",
		label: "Inverter (NOT)",
		icon: "fa-solid fa-circle-xmark",
		description: "Inverts child result.",
		tick: async (node, bb, engine) => {
			if (!node.child) return Status.FAILURE;
			const status = await engine._tick_node(node.child, bb);
			if (status === Status.SUCCESS) return Status.FAILURE;
			if (status === Status.FAILURE) return Status.SUCCESS;
			return Status.RUNNING;
		},
	});
}