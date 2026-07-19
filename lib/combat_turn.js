/**
 * combat_turn.js — Deadlands combat / initiative helpers for BT integration.
 */

let _active_combat_turn = null;

export function is_dc_combat_active() {
	return game.dc?.combat_active
		?? game.settings.get("Deadlands-Classic", "combat_active")
		?? false;
}

export function get_current_initiative_entry() {
	if (!is_dc_combat_active() || !game.dc?.combat) return null;
	return game.dc.combat.build_initiative_queue()[0] ?? null;
}

export function get_active_combat_turn() {
	if (!is_dc_combat_active()) {
		_active_combat_turn = null;
	}
	return _active_combat_turn;
}

export function set_active_combat_turn(entry) {
	if (!entry?.token_id && !entry?.actor_id) {
		_active_combat_turn = null;
		return;
	}
	if (is_dc_combat_active() && !entry?.token_id) {
		console.warn("dc-npc-patrols | set_active_combat_turn: missing token_id on initiative entry");
	}
	_active_combat_turn = {
		actor_id: entry.actor_id,
		token_id: entry.token_id ?? null,
		card_name: entry.card_name ?? null,
	};
}

export function clear_active_combat_turn() {
	_active_combat_turn = null;
}

export function is_actors_turn(actor_id, token_id = null) {
	const active = get_active_combat_turn();
	if (!active) return false;
	if (active.token_id && token_id) return active.token_id === token_id;
	if (active.token_id) return false;
	return active.actor_id === actor_id;
}
