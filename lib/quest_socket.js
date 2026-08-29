/**
 * quest_socket.js — Player→GM quest writes and quest-state broadcast cache.
 *
 * Posse records live in a GM-owned world journal, so quest WRITES must be
 * performed by the GM client (see posse.set_quest / posse.delete_quest —
 * both GM-gated). READS come from a GM-broadcast cache so player clients
 * never need journal read permission.
 *
 * Events (socket channel: module.dc-npc-patrols):
 *   quest_request  — Player → GM: please broadcast { posse_id } quest state
 *   quest_write    — Player → GM: { op: "set"|"delete", posse_id, quest_id, data }
 *   quest_state    — GM → ALL: { posse_id, quests } — updates the local cache
 */

const MODULE_ID = "dc-npc-patrols";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;

/** @type {Map<string, Object>} posse_id → quests map (GM-broadcast cache) */
const _quest_cache = new Map();

/** @type {Object|null} hook set by main.js on dcReady — called after every write */
let _on_change_hook = null;

/**
 * Register a callback fired after any local quest write completes.
 * Used by the hub/tabs to re-render. Returns an unsubscribe function.
 * @param {Function} fn
 * @returns {Function} unsubscribe
 */
function on_quest_change(fn) {
	_on_change_hook = fn;
	return () => {
		if (_on_change_hook === fn) _on_change_hook = null;
	};
}

// ── Player-facing API ─────────────────────────────────────────────

/**
 * Read a posse's quests from the GM-broadcast cache.
 * @param {string} posse_id
 * @returns {Object} quests map ({} when unknown)
 */
function get_cached_quests(posse_id) {
	return _quest_cache.get(posse_id) || {};
}

/**
 * Ask the GM to broadcast a posse's quest state. GM clients read the
 * authoritative posse store directly instead.
 * @param {string} posse_id
 */
function request_quest_state(posse_id) {
	if (!posse_id) return;
	if (game.user.isGM) {
		_broadcast_state(posse_id);
		return;
	}
	game.socket.emit(SOCKET_CHANNEL, {
		event: "quest_request",
		posse_id,
		sender: game.user.id,
	});
}

/**
 * Write quest state — direct posse call on the GM client, socket round-trip
 * for players. Shared by the modify_quest boon and the hub live-edit form.
 * @param {"set"|"delete"} op
 * @param {{posse_id: string, quest_id: string, data?: Object}} payload
 * @returns {Promise<Object|null>} written instance on GM direct path, else null
 */
async function request_quest_write(op, payload) {
	const { posse_id, quest_id, data } = payload || {};
	if (game.user.isGM) {
		if (op === "set") {
			await game.dc.posse.set_quest(posse_id, quest_id, data);
			_broadcast_state(posse_id);
			return data ?? null;
		}
		await game.dc.posse.delete_quest(posse_id, quest_id);
		_broadcast_state(posse_id);
		return null;
	}
	game.socket.emit(SOCKET_CHANNEL, {
		event: "quest_write",
		op,
		posse_id,
		quest_id,
		data,
		sender: game.user.id,
	});
	return null;
}

// ── Internal ──────────────────────────────────────────────────────

/**
 * Send a posse's fresh quest map to ALL clients and update the local cache.
 * @param {string} posse_id
 */
function _broadcast_state(posse_id) {
	if (!posse_id) return;
	if (!game.dc?.posse) return;
	const quests = game.dc.posse.get_quests(posse_id);
	_quest_cache.set(posse_id, quests);
	game.socket.emit(SOCKET_CHANNEL, {
		event: "quest_state",
		posse_id,
		quests,
	});
	_notify_change(posse_id, quests);
}

function _notify_change(posse_id, quests) {
	try {
		_on_change_hook?.(posse_id, quests);
	} catch (err) {
		console.error(`[${MODULE_ID}|quests] change hook failed:`, err);
	}
}

/**
 * GM-side: apply a quest_write request.
 * @param {object} data — { op, posse_id, quest_id, data }
 */
async function _gm_apply_write(data) {
	if (!game.user.isGM || !game.dc?.posse) return;
	if (data.op === "set") {
		await game.dc.posse.set_quest(data.posse_id, data.quest_id, data.data);
	} else if (data.op === "delete") {
		await game.dc.posse.delete_quest(data.posse_id, data.quest_id);
	}
	// set_quest/delete_quest triggered the change hook; broadcast for all clients.
	_broadcast_state(data.posse_id);
}

/**
 * Handle incoming socket events on the module channel.
 * @param {object} data
 */
function handle_socket(data) {
	if (!data?.event) return;

	if (data.event === "quest_request") {
		if (!game.user.isGM) return;
		// Targeted reply is unnecessary — broadcast is idempotent and keeps
		// every client's cache fresh.
		_broadcast_state(data.posse_id);
	} else if (data.event === "quest_write") {
		void _gm_apply_write(data);
	} else if (data.event === "quest_state") {
		_quest_cache.set(data.posse_id, data.quests || {});
		_notify_change(data.posse_id, data.quests || {});
	}
}

/**
 * Register the socket listener.
 */
function register_socket() {
	if (!game.socket) return;
	game.socket.on(SOCKET_CHANNEL, handle_socket);
}

export {
	register_socket,
	request_quest_state,
	request_quest_write,
	get_cached_quests,
	on_quest_change,
};

/**
 * Hook installed on `posse_api._on_quest_change` by register_quest_socket().
 * After the GM client persists a posse quest write, broadcast fresh state to
 * every client (the GM's own local cache included).
 * @param {string} posse_id
 */
function posse_quest_change_broadcaster(posse_id) {
	_broadcast_state(posse_id);
}

/**
 * Full registration — call from dcReady in main.js:
 * socket listener + the posse change hook that triggers broadcasts.
 */
function register_quest_socket() {
	register_socket();
	if (game.dc?.posse) {
		game.dc.posse._on_quest_change = posse_quest_change_broadcaster;
	} else {
		console.warn(`[${MODULE_ID}|quests] game.dc.posse unavailable — quest broadcasts disabled.`);
	}
}