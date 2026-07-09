/**
 * region_manager.js — Auto-create / update / cleanup proximity regions
 * for NPC dialog trees and ambient line sets.
 *
 * Two kinds of auto-created regions:
 *   - Dialog regions: attach a `dcDialogTree` behavior (opens conversation UI)
 *   - Ambient regions: attach a `dcAmbient` behavior (whispers random flavour lines)
 *
 * Also retains the Phase 1 waypoint-proximity helper used by patrol_engine.
 */

const MODULE_ID = "dc-npc-patrols";

export class RegionManager {
	constructor(module_id) {
		this.module_id = module_id;
		// Track active waypoint-proximity regions by token id: { token_id: region_id }
		this._regions = new Map();
	}

	// ── Phase 1: waypoint proximity regions ──────────────────────────

	/**
	 * Update (or create) the proximity region for a token at a waypoint.
	 * Phase 1 lightweight region — no dialog/ambient behavior.
	 */
	async update_for_waypoint(token_doc, actor, waypoint) {
		const radius = waypoint.region_radius ?? game.settings.get(this.module_id, "proximity_radius");
		if (!radius || radius <= 0) return;

		await this.remove_for_token(token_doc.id);

		const scene = token_doc.parent;
		if (!scene) return;

		const region = await this._create_proximity_region(token_doc, scene, radius, waypoint);
		if (region) {
			this._regions.set(token_doc.id, region.id);
		}
	}

	async _create_proximity_region(token_doc, scene, radius_squares, _waypoint) {
		const grid_size = scene.grid.size;
		const radius_px = radius_squares * grid_size;
		const token = token_doc.object;
		if (!token) return null;

		const center = token.center;

		const region_data = {
			name: `${token_doc.name} Proximity`,
			visibility: 0,
			shapes: [{
				type: "circle",
				x: center.x,
				y: center.y,
				radius: radius_px,
			}],
			behaviors: [],
		};

		return await RegionDocument.create(region_data, { parent: scene });
	}

	async remove_for_token(token_id) {
		const region_id = this._regions.get(token_id);
		if (!region_id) return;

		const scene = canvas.scene;
		if (!scene) return;

		const region = scene.regions.get(region_id);
		if (region) await region.delete();
		this._regions.delete(token_id);
	}

	async cleanup_all() {
		const scene = canvas.scene;
		if (!scene) return;

		for (const [_token_id, region_id] of this._regions) {
			const region = scene.regions.get(region_id);
			if (region) await region.delete();
		}
		this._regions.clear();
	}

	// ── Phase 3: dialog / ambient proximity regions ──────────────────

	/**
	 * Create a circular region with a `dcDialogTree` behavior centered on
	 * the given token.
	 *
	 * @param {Scene} scene
	 * @param {TokenDocument} token_doc
	 * @param {string} tree_id
	 * @param {string} actor_id — NPC actor id
	 * @param {number} radius_squares
	 * @returns {Promise<string|null>} region UUID
	 */
	async create_dialog_region(scene, token_doc, tree_id, actor_id, radius_squares) {
		const trees = game.settings.get(MODULE_ID, "dialog_trees") || {};
		const tree = trees[tree_id];
		const tree_name = tree?.name || tree_id;
		const region_name = `DC Dialog: ${token_doc.name} (${tree_name})`;

		return await this._create_behavior_region(
			scene, token_doc, region_name, radius_squares,
			"dc-npc-patrols.dcDialogTree",
			{ tree_id, actor_id },
		);
	}

	/**
	 * Create a circular region with a `dcAmbient` behavior centered on
	 * the given token.
	 *
	 * @param {Scene} scene
	 * @param {TokenDocument} token_doc
	 * @param {string} set_id
	 * @param {string} actor_id — NPC actor id
	 * @param {number} radius_squares
	 * @returns {Promise<string|null>} region UUID
	 */
	async create_ambient_region(scene, token_doc, set_id, actor_id, radius_squares) {
		const sets = game.settings.get(MODULE_ID, "ambient_sets") || {};
		const set = sets[set_id];
		const set_name = set?.name || set_id;
		const region_name = `DC Ambient: ${token_doc.name} (${set_name})`;

		return await this._create_behavior_region(
			scene, token_doc, region_name, radius_squares,
			"dc-npc-patrols.dcAmbient",
			{ set_id, actor_id },
		);
	}

	/**
	 * Internal: create a circular region with a behavior attached.
	 * @returns {Promise<string|null>} region UUID
	 */
	async _create_behavior_region(scene, token_doc, region_name, radius_squares, behavior_type, system_data) {
		const token = token_doc.object;
		if (!token) return null;

		const radius_px = radius_squares * scene.grid.size;
		const center = token.center;

		const region_data = {
			name: region_name,
			visibility: 0,
			// Attach region to the token — Foundry auto-moves it when the token moves.
			// Requirements: single shape, same level, same hidden state.
			attachment: { token: token_doc.id },
			levels: [token_doc._source.level ?? null],
			hidden: token_doc.hidden,
			shapes: [{
				type: "circle",
				x: center.x,
				y: center.y,
				radius: radius_px,
			}],
			behaviors: [{
				type: behavior_type,
				events: [CONST.REGION_EVENTS.TOKEN_ENTER],
				system: system_data,
			}],
		};

		const [region] = await scene.createEmbeddedDocuments("Region", [region_data]);
		return region?.uuid ?? null;
	}

	// Note: update_region_position() is no longer needed — Foundry auto-moves
	// regions attached to a token via attachment.token.

	/**
	 * Delete a region by UUID.
	 * @param {Scene} scene
	 * @param {string} region_uuid
	 */
	async delete_region(scene, region_uuid) {
		const region = await fromUuid(region_uuid);
		if (!region || region.parent?.id !== scene.id) return;
		await region.delete();
	}

	/**
	 * Sync all auto-created dialog/ambient regions for the given scene.
	 * For each actor with attachments, find their token(s) on the scene and:
	 *   - Create a region if missing
	 *   - Reposition if the token has moved
	 *
	 * Called on canvasReady.
	 * @param {Scene} scene
	 */
	async sync_all_regions(scene) {
		if (!scene) return;

		// Iterate all actors with dialog or ambient attachments
		for (const actor of game.actors) {
			const flags = actor.getFlag(MODULE_ID, "dialog_attachments");
			if (flags?.length) {
				for (const att of flags) {
					await this._sync_one(scene, actor, att, "dialog");
				}
			}
			const amb = actor.getFlag(MODULE_ID, "ambient_attachments");
			if (amb?.length) {
				for (const att of amb) {
					await this._sync_one(scene, actor, att, "ambient");
				}
			}
		}
	}

	async _sync_one(scene, actor, attachment, kind) {
		const token_docs = scene.tokens.filter((t) => t.actor?.id === actor.id);
		if (!token_docs.length) return;

		for (const token_doc of token_docs) {
			if (attachment.region_uuid) {
				// Region exists and is attached to the token — Foundry handles repositioning
			} else {
				// Region missing — create it
				const radius = attachment.region_radius ?? game.settings.get(MODULE_ID, "proximity_radius");
				let uuid = null;
				if (kind === "dialog") {
					uuid = await this.create_dialog_region(scene, token_doc, attachment.tree_id, actor.id, radius);
				} else {
					uuid = await this.create_ambient_region(scene, token_doc, attachment.set_id, actor.id, radius);
				}
				if (uuid) {
					// Persist the UUID on the attachment
					await this._update_attachment_uuid(actor, kind, attachment, uuid);
				}
			}
		}
	}

	/**
	 * Update an attachment's region_uuid in the actor's flags.
	 */
	async _update_attachment_uuid(actor, kind, attachment, uuid) {
		const flag_key = kind === "dialog" ? "dialog_attachments" : "ambient_attachments";
		const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, flag_key) || []);
		const idx = list.findIndex((a) =>
			(kind === "dialog" ? a.tree_id === attachment.tree_id : a.set_id === attachment.set_id)
		);
		if (idx >= 0) {
			list[idx].region_uuid = uuid;
			await actor.setFlag(MODULE_ID, flag_key, list);
		}
	}

	/**
	 * Clean up regions when a token is deleted.
	 * Finds any dialog/ambient regions on the scene that referenced this actor
	 * and had a behavior pointing to the deleted token's actor.
	 * @param {Scene} scene
	 * @param {TokenDocument} token_doc
	 */
	async cleanup_for_deleted_token(scene, token_doc) {
		if (!scene) return;
		const actor_id = token_doc.actor?.id;
		if (!actor_id) return;

		// Find regions whose behavior system.actor_id matches
		const to_delete = [];
		for (const region of scene.regions) {
			for (const behavior of region.behaviors) {
				if (behavior.system?.actor_id === actor_id &&
					(behavior.type === "dc-npc-patrols.dcDialogTree" || behavior.type === "dc-npc-patrols.dcAmbient")) {
					to_delete.push(region.id);
					break;
				}
			}
		}
		if (to_delete.length) {
			await scene.deleteEmbeddedDocuments("Region", to_delete);
		}
	}
}