/**
 * set_dialog.js — BT action node: swap NPC dialog/ambient attachments.
 *
 * Removes existing dialog and/or ambient attachments and adds new ones,
 * recreating proximity regions automatically. Lets NPCs change what
 * they say based on story state (e.g. friendly → hostile dialog when
 * a flag is set, day → night ambient lines on a schedule).
 *
 * Each channel (dialog / ambient) has an explicit action:
 *   set   (default) — if the id field resolves to a value, attach that tree/set;
 *                     if it resolves empty, leave the channel unchanged.
 *   clear           — remove all attachments on that channel.
 *
 * This lets a shared fragment carry an optional dialog field that most actors
 * leave blank (a no-op) while still supporting an explicit clear (e.g. Rest).
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import {
	replace_attachments,
	remove_all_attachments,
	has_sole_attachment,
} from "../../attachment_editor.js";
import { get_trees, get_ambient_sets } from "../../dialog_tree_store.js";

export function register() {
	register_node("action_set_dialog", {
		category: "action",
		label: "Action: Set Dialog",
		icon: "fa-solid fa-comments",
		description: "Swaps the NPC's dialog tree and/or ambient set by removing existing attachments and adding new ones. Proximity regions are recreated automatically. Use to change what an NPC says based on story events.",

		async tick(node, bb, engine) {
			const actor = bb.actor;
			if (!actor) return Status.FAILURE;

			const attachment_type = node.attachment_type || "dialog";
			const rm = engine.region_manager;
			if (!rm) return Status.FAILURE;

			// {{var}} placeholders are resolved by the engine before tick.
			const tree_id = node.tree_id || "";
			const set_id = node.set_id || "";
			const time_start = node.time_start || null;
			const time_end = node.time_end || null;
			const region_radius = parseInt(node.region_radius, 10) || 0;

			// Explicit per-channel action. Default "set" leaves the channel
			// unchanged when the id is empty; "clear" removes all attachments.
			const dialog_action = node.dialog_action || "set";
			const ambient_action = node.ambient_action || "set";

			const config = { time_start, time_end, region_radius };

			try {
				if (attachment_type === "dialog" || attachment_type === "both") {
					if (dialog_action === "clear") {
						await remove_all_attachments(actor, "dialog", rm);
					} else if (tree_id) {
						const trees = get_trees();
						if (!trees[tree_id]) {
							console.warn(`[dc-npc-patrols|set_dialog] Dialog tree not found: ${tree_id}`);
							return Status.FAILURE;
						}
						if (!has_sole_attachment(actor, "dialog", "tree_id", tree_id)) {
							config.tree_id = tree_id;
							const result = await replace_attachments(actor, "dialog", config, rm);
							if (!result) return Status.FAILURE;
						}
					}
					// dialog_action "set" with empty tree_id → leave unchanged.
				}

				if (attachment_type === "ambient" || attachment_type === "both") {
					if (ambient_action === "clear") {
						await remove_all_attachments(actor, "ambient", rm);
					} else if (set_id) {
						const sets = get_ambient_sets();
						if (!sets[set_id]) {
							console.warn(`[dc-npc-patrols|set_dialog] Ambient set not found: ${set_id}`);
							return Status.FAILURE;
						}
						if (!has_sole_attachment(actor, "ambient", "set_id", set_id)) {
							config.set_id = set_id;
							const result = await replace_attachments(actor, "ambient", config, rm);
							if (!result) return Status.FAILURE;
						}
					}
					// ambient_action "set" with empty set_id → leave unchanged.
				}
			} catch (err) {
				console.error("[dc-npc-patrols|set_dialog] Failed to set attachment:", err);
				return Status.FAILURE;
			}

			return Status.SUCCESS;
		},

		editor: {
			fields: [
				{
					key: "attachment_type",
					type: "dropdown",
					label: "Attachment Type",
					default: "dialog",
					options: [
						{ value: "dialog", label: "Dialog Tree" },
						{ value: "ambient", label: "Ambient Set" },
						{ value: "both", label: "Both" },
					],
				},
				{
					key: "dialog_action",
					type: "dropdown",
					label: "Dialog Action",
					default: "set",
					options: [
						{ value: "set", label: "Set (ignore if blank)" },
						{ value: "clear", label: "Clear (remove all)" },
					],
				},
				{
					key: "ambient_action",
					type: "dropdown",
					label: "Ambient Action",
					default: "set",
					options: [
						{ value: "set", label: "Set (ignore if blank)" },
						{ value: "clear", label: "Clear (remove all)" },
					],
				},
				{ key: "tree_id", type: "dialog_tree_select", label: "Dialog Tree", default: "" },
				{ key: "set_id", type: "ambient_set_select", label: "Ambient Set", default: "" },
				{ key: "time_start", type: "text", label: "Time Start (HH:MM)", default: "" },
				{ key: "time_end", type: "text", label: "Time End (HH:MM)", default: "" },
				{ key: "region_radius", type: "number", label: "Region Radius (squares, 0 = default)", default: 0 },
			],
		},
	});
}
