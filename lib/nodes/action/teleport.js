/**
 * teleport.js — Action: Teleport
 *
 * Instantly teleports the NPC (or a blackboard target token) to a named
 * region on the scene, or to a raw region UUID. Uses Foundry's native
 * RegionDocument.teleportToken() so the destination region's teleport
 * behaviors (view switching, level changes) apply.
 *
 * Unlike move_to_region, this is instant — no pathfinding.
 */

import { Status } from "../../bt_engine.js";
import { register_node } from "../registry.js";
import { resolve_token_ref } from "../../token_target.js";
import { find_regions_by_name } from "../../region_utils.js";
import { bt_log } from "../../bt_debug.js";

export function register() {
	register_node("action_teleport", {
		category: "action",
		label: "Action: Teleport",
		icon: "fa-solid fa-arrow-right-to-bracket",
		description: "Instantly teleports the NPC or a blackboard target token to a named region (or raw region UUID). Uses Foundry's native teleportToken.",
		tick: async (node, bb) => {
			if (!bb.token || !bb.scene) return Status.FAILURE;

			// Resolve the token to teleport (self by default).
			let token_doc = bb.token;
			const target_key = (node.target_key || "").trim();
			if (target_key) {
				token_doc = resolve_token_ref(bb, target_key) ?? bb.token;
			}

			// Resolve the destination region.
			let destination_uuid = (node.destination_uuid || "").trim();
			const region_name = (node.region_name || "").trim();
			if (!destination_uuid && region_name) {
				const region = find_regions_by_name(bb.scene, region_name)[0];
				if (region) destination_uuid = region.uuid;
			}
			if (!destination_uuid) return Status.FAILURE;

			const dest = await fromUuid(destination_uuid);
			if (!dest?.teleportToken) {
				bt_log("teleport", `destination not found or not a region: ${destination_uuid}`);
				return Status.FAILURE;
			}

			try {
				await dest.teleportToken(token_doc, {
					placement: "center",
					snap: true,
				});
			} catch (err) {
				console.warn(`dc-npc-patrols | action_teleport failed for ${destination_uuid}:`, err);
				return Status.FAILURE;
			}

			bt_log("teleport", `token=${token_doc.name} → ${destination_uuid}`);
			return Status.SUCCESS;
		},
		editor: {
			fields: [
				{ key: "region_name", type: "region_select", label: "Destination Region", default: "" },
				{ key: "destination_uuid", type: "text", label: "Destination Region UUID (overrides region name)", default: "" },
				{ key: "target_key", type: "text", label: "Target Blackboard Key (blank = self)", default: "" },
			],
		},
	});
}
