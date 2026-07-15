/**
 * cross_scene.js — Cross-scene token despawn/respawn for NPC patrols.
 *
 * When a waypoint targets a different scene, the token is hidden on the
 * current scene and a token is created/shown on the target scene at the
 * waypoint's position.
 */

export class CrossScene {
	constructor(module_id) {
		this.module_id = module_id;
	}

	// --- Transition a token from current scene to target scene ---
	async transition(token_doc, actor, waypoint) {
		const target_scene_id = waypoint.scene_id;
		if (!target_scene_id) return;

		// Hide token on current scene
		await token_doc.update({ hidden: true });

		// Find or create token on target scene
		const target_scene = game.scenes.get(target_scene_id);
		if (!target_scene) {
			console.warn(`[${this.module_id}] Target scene not found: ${target_scene_id}`);
			return;
		}

		await this._find_or_create_token(actor, target_scene, waypoint);
	}

	// --- Find existing token for actor on target scene, or create new ---
	async _find_or_create_token(actor, scene, waypoint) {
		const grid = scene.grid.size;
		const px_x = waypoint.x * grid;
		const px_y = waypoint.y * grid;

		// Look for existing token (linked or unlinked) for this actor
		let token_doc = scene.tokens.find((t) => {
			if (t.actorId === actor.id) return true;
			if (t.actorLink && t.actor?.id === actor.id) return true;
			return false;
		});

		if (token_doc) {
			// Update position and unhide.
			// Use move() with action: "displace" so any Change Level regions at the
			// destination don't fire their confirmation dialog.
			const wp = { x: px_x, y: px_y, action: "displace" };
			await token_doc.move([wp], { animate: false });
			if (waypoint.face_direction != null) {
				await token_doc.update({ rotation: waypoint.face_direction, hidden: false }, { animate: false, diff: false });
			} else {
				await token_doc.update({ hidden: false }, { animate: false, diff: false });
			}
		} else {
			// Create new token on target scene
			const td_data = {
				actorId: actor.id,
				x: px_x,
				y: px_y,
				hidden: false,
			};
			if (waypoint.face_direction != null) {
				td_data.rotation = waypoint.face_direction;
			}
			await TokenDocument.create(td_data, { parent: scene });
		}
	}

	// --- Get all tokens for an actor across all scenes ---
	get_all_tokens_for_actor(actor) {
		const tokens = [];
		for (const scene of game.scenes) {
			for (const token_doc of scene.tokens) {
				if (token_doc.actorId === actor.id) {
					tokens.push({ scene, token_doc });
				}
			}
		}
		return tokens;
	}
}