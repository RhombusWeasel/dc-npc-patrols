/**
 * modify_flag boon handler — create, destroy, or change actor/posse quest flags.
 *
 * Modes:
 *   'set'    — creates or updates a flag value
 *   'delete' — removes a flag entirely
 *
 * Scope:
 *   'actor' — sets/deletes on the triggering actor's quest_flags
 *   'posse' — sets/deletes on all player members of the actor's posse
 *             (writes to posse_quest_flags; falls back to actor-level if no posse)
 *
 * Actor-scope sets accumulate into context.pending_flag_sets (flushed by
 * resolve_context.js after all boons run).  Posse-scope and delete operations
 * are applied immediately since they need multi-actor or unsetFlag handling.
 *
 * Works inside roll_gate boon lists (pass_boons / fail_boons) so you can gate
 * flag changes behind a skill check — e.g. a persuade check that sets a flag
 * to divert a conversation branch.
 *
 * @param {object} boon   — { type, mode, scope_type, flag_key, flag_value, target }
 * @param {object} context — mutable context from trigger_manager
 */
const MODULE_ID = "dc-npc-patrols";

export default function modify_flag(boon, context) {
	const actor = boon.target === 'target' ? (context.target ?? context.actor) : context.actor;
	if (!actor) return;

	const mode = boon.mode || 'set';
	const scope_type = boon.scope_type || 'actor';
	const key = boon.flag_key;
	if (!key) return;

	const flag_path = scope_type === 'posse' ? 'posse_quest_flags' : 'quest_flags';
	const full_path = `${flag_path}.${key}`;

	if (mode === 'delete') {
		_apply_delete(actor, scope_type, full_path);
		return;
	}

	// mode === 'set'
	const value = boon.flag_value ?? true;

	if (scope_type === 'posse') {
		_apply_posse_set(actor, key, value);
	} else {
		// Actor scope — accumulate for batch flush by resolve_context.js
		if (!context.pending_flag_sets) context.pending_flag_sets = [];
		context.pending_flag_sets.push({ actor, scope: MODULE_ID, path: full_path, value });
	}
}

/**
 * Delete a flag.  For posse scope, deletes from all player members.
 * @param {Actor} actor
 * @param {string} scope_type  — 'actor' or 'posse'
 * @param {string} full_path   — e.g. 'quest_flags.my_key' or 'posse_quest_flags.my_key'
 */
async function _apply_delete(actor, scope_type, full_path) {
	if (scope_type === 'posse') {
		const posse = game.dc.posse?.get_posse_for_actor(actor);
		if (!posse) {
			await actor.unsetFlag(MODULE_ID, full_path);
			return;
		}
		const members = game.dc.posse.get_player_members(posse.id);
		for (const member of members) {
			await member.unsetFlag(MODULE_ID, full_path);
		}
	} else {
		await actor.unsetFlag(MODULE_ID, full_path);
	}
}

/**
 * Set a flag on all player members of the actor's posse.
 * Falls back to actor-level quest_flags if no posse exists.
 * Applied directly (not via pending_flag_sets) since it writes to multiple actors.
 * @param {Actor} actor
 * @param {string} key
 * @param {*} value
 */
async function _apply_posse_set(actor, key, value) {
	const posse = game.dc.posse?.get_posse_for_actor(actor);
	if (!posse) {
		// No posse — fall back to actor-level
		await actor.setFlag(MODULE_ID, `quest_flags.${key}`, value);
		return;
	}
	const members = game.dc.posse.get_player_members(posse.id);
	for (const member of members) {
		await member.setFlag(MODULE_ID, `posse_quest_flags.${key}`, value);
	}
}