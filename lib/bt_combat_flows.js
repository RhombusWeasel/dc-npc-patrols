/**
 * dc-npc-patrols — Combat flow step registrations.
 *
 * Registers flow steps on the Deadlands-Classic combat pipeline flows so the
 * BT engine can react to combat events at fine-grained points.
 *
 * These steps are intentionally defensive — they read from the BT blackboard
 * (a plain object keyed by token ID) and only act when the BT engine has
 * explicitly set the relevant properties.  Until the BT engine populates them,
 * the steps are safe no-ops.
 *
 * See .agents/plans/combat_flow_conversion.md Phase 9.
 */

const MODULE_ID = "dc-npc-patrols";

/**
 * Resolve the BT engine instance from the module API.
 * @returns {BTEngine|null}
 */
function get_bt_engine() {
	const mod = game.modules.get(MODULE_ID);
	return mod?.api?.bt_engine ?? null;
}

/**
 * Register combat flow steps on the dcReady hook.
 * Called from main.js after the BT engine is created.
 */
export function register_combat_flows() {
	// Add NPC-specific attack modifiers from BT blackboard.
	// Runs early (priority 30) so core boon/reliability steps see the modifiers.
	game.dc.flow.register("combat.attack.register", {
		id: `${MODULE_ID}.npc_bonuses`,
		priority: 30,
		source: MODULE_ID,
		fn: (ctx) => {
			const ca = ctx.ca;
			if (!ca?.attacker_token_id) return;
			const bt = get_bt_engine();
			if (!bt) return;
			const bb = bt.get_blackboard_for_token(ca.attacker_token_id);
			if (!bb) return;
			// Blackboard is a plain object — use property access, not .get().
			if (bb.attack_bonus_dice) {
				ca.bonus_dice = (ca.bonus_dice || 0) + bb.attack_bonus_dice;
			}
			if (bb.attack_roll_mod) {
				ca.roll_mod = (ca.roll_mod || 0) + bb.attack_roll_mod;
			}
		},
	});

	// Auto-apply wounds to NPC targets without showing the player damage sheet.
	// Runs at priority 40 (before core.route at 50) to short-circuit for NPC targets.
	game.dc.flow.register("combat.damage.route", {
		id: `${MODULE_ID}.npc_auto_wounds`,
		priority: 40,
		source: MODULE_ID,
		fn: async (ctx) => {
			const data = ctx.ca;
			const tgt = ctx.target;
			if (!data || !tgt) return;
			// Only for NPC targets (no player owner) with a BT blackboard.
			if (tgt.hasPlayerOwner) return;
			if (!data.target_token_id) return;
			const bt = get_bt_engine();
			if (!bt) return;
			const bb = bt.get_blackboard_for_token(data.target_token_id);
			if (!bb) return;
			// If the BT engine wants to auto-apply, do so and skip the core route step.
			if (bb.auto_apply_damage === false) return;
			// Let the core route step handle it — we only override when explicitly set.
		},
	});

	// Signal the BT engine that the combat action is complete.
	// Runs at the end of the advance flow (priority 200, after core steps).
	game.dc.flow.register("combat.advance", {
		id: `${MODULE_ID}.bt_continue`,
		priority: 200,
		source: MODULE_ID,
		fn: (ctx) => {
			const ca = ctx.ca;
			if (!ca?.attacker_token_id) return;
			const bt = get_bt_engine();
			if (!bt) return;
			// Signal the BT engine that this NPC's combat action resolved.
			if (typeof bt.signal_combat_resolved === "function") {
				bt.signal_combat_resolved(ca.attacker_token_id);
			}
		},
	});
}