/**
 * terrain_cost_behavior.js — Region behavior type for terrain cost weighting.
 *
 *   dcTerrainCost — assigns a numeric movement cost multiplier to all nav-cells
 *   covered by the region. The A* pathfinder reads this during grid rasterization
 *   and multiplies the base movement cost by it, causing NPCs to prefer cheaper
 *   routes when alternatives exist.
 *
 * This behavior is purely a data carrier — no event handlers. The pathfinder
 * reads it during grid construction in _get_or_build_grid().
 */

const { RegionBehaviorType } = foundry.data.regionBehaviors;
const MODULE_ID = "dc-npc-patrols";

/**
 * dcTerrainCost behavior — assigns a movement cost multiplier to terrain.
 *
 * Cost is a multiplier: 1.0 = normal terrain, 2.0 = twice as expensive, etc.
 * Minimum is 1.0 so the heuristic stays admissible (terrain never makes
 * movement cheaper than base).
 */
class DCTerrainCostBehaviorType extends RegionBehaviorType {
	static defineSchema() {
		const { fields } = foundry.data;
		return {
			cost: new fields.NumberField({
				required: true,
				initial: 1,
				minimum: 1,
				label: `${MODULE_ID}.behavior.dcTerrainCost.cost`,
				hint: `${MODULE_ID}.behavior.dcTerrainCost.cost_hint`,
			}),
		};
	}

	// No events — purely a data carrier read by the pathfinder

	static LOCALIZATION_PREFIXES = [`${MODULE_ID}.behavior.dcTerrainCost`];
}

// ── Registration ───────────────────────────────────────────────────

/**
 * Register the dcTerrainCost region behavior type.
 * Must be called during init (before any region config sheet renders).
 */
export function register_terrain_cost_behavior() {
	const type_id = `${MODULE_ID}.dcTerrainCost`;

	CONFIG.RegionBehavior.typeLabels[type_id] = `TYPES.RegionBehavior.${MODULE_ID}.dcTerrainCost`;
	CONFIG.RegionBehavior.typeHints[type_id] = `TYPES.HINTS.RegionBehavior.${MODULE_ID}.dcTerrainCost`;
	CONFIG.RegionBehavior.dataModels[type_id] = DCTerrainCostBehaviorType;
	CONFIG.RegionBehavior.typeIcons[type_id] = "fa-solid fa-mountain";
}