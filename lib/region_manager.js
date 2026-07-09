/**
 * region_manager.js — Auto-attach and update proximity regions around NPC tokens.
 *
 * When an NPC arrives at a waypoint, creates (or updates) a circular region
 * centered on the token. In Phase 1 this is a lightweight stub that just
 * tracks position. In Phase 3 it will attach dcDialogTree + boon behaviors.
 */

export class RegionManager {
	constructor(module_id) {
		this.module_id = module_id;
		// Track active proximity regions by token id: { token_id: region_id }
		this._regions = new Map();
	}

	// --- Update (or create) the proximity region for a token at a waypoint ---
	async update_for_waypoint(token_doc, actor, waypoint) {
		// Phase 1: only create regions if region_radius > 0
		const radius = waypoint.region_radius ?? game.settings.get(this.module_id, "proximity_radius");
		if (!radius || radius <= 0) return;

		// Remove old region if exists
		await this.remove_for_token(token_doc.id);

		// Skip if no scene
		const scene = token_doc.parent;
		if (!scene) return;

		// Create new proximity region
		const region = await this._create_proximity_region(token_doc, scene, radius, waypoint);

		if (region) {
			this._regions.set(token_doc.id, region.id);
		}
	}

	// --- Create a circular region around the token ---
	async _create_proximity_region(token_doc, scene, radius_squares, waypoint) {
		const grid_size = scene.grid.size;
		const radius_px = radius_squares * grid_size;
		const token = token_doc.object;
		if (!token) return null;

		const center = token.center;

		const region_data = {
			name: `${token_doc.name} Proximity`,
			visibility: 0, // hidden from players
			shapes: [{
				type: "circle",
				x: center.x,
				y: center.y,
				radius: radius_px,
			}],
			behaviors: [],
		};

		// Phase 3: add dcDialogTree + boon behaviors here
		// For now, just create the region so it exists and can be expanded later
		const region = await RegionDocument.create(region_data, { parent: scene });
		return region;
	}

	// --- Remove the proximity region for a token ---
	async remove_for_token(token_id) {
		const region_id = this._regions.get(token_id);
		if (!region_id) return;

		const scene = canvas.scene;
		if (!scene) return;

		const region = scene.regions.get(region_id);
		if (region) {
			await region.delete();
		}
		this._regions.delete(token_id);
	}

	// --- Clean up all regions (e.g., on scene change) ---
	async cleanup_all() {
		const scene = canvas.scene;
		if (!scene) return;

		for (const [token_id, region_id] of this._regions) {
			const region = scene.regions.get(region_id);
			if (region) {
				await region.delete();
			}
		}
		this._regions.clear();
	}
}