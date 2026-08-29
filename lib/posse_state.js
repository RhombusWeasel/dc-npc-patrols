/**
 * posse_state.js — Generic per-posse, per-module state layer.
 *
 * Any module can register a namespace (e.g. "quests", "bounties") and get:
 *   - storage in the system posse store (posse_api ext bag, ext.<ns>)
 *   - GM-gated writes: direct on a GM client, socket round-trip for players
 *   - a GM-broadcast read cache so player clients never touch the journal
 *   - change callbacks fired whenever a namespace's state lands locally
 *
 * The system side only knows the ext bag (posse.get_ext/set_ext, fires
 * _on_ext_change(posse_id, ns)); it never interprets bag contents. This
 * module owns the transport and cache. Quests (quest_socket.js) are the
 * first consumer; future per-posse features register their own namespace
 * with zero system or transport changes.
 *
 * Socket events (channel: module.dc-npc-patrols):
 *   posse_ext_request — Player → GM: re-broadcast { posse_id, ns }
 *   posse_ext_write   — Player → GM: { posse_id, ns, bag }
 *   posse_ext_state   — GM → ALL:    { posse_id, ns, bag }
 */

const MODULE_ID = "dc-npc-patrols";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;

/** @type {Map<string, Set<Function>>} ns → subscribers fn(posse_id, bag) */
const _subscribers = new Map();

/** @type {Map<string, Map<string, Object>>} ns → (posse_id → bag) */
const _cache = new Map();

// ── Public API (per namespace) ────────────────────────────────────

/**
 * Subscribe to changes for a namespace. Returns an unsubscribe function.
 * The callback fires with (posse_id, bag) whenever fresh state for that
 * namespace lands on this client (broadcast received or local write).
 * @param {string} ns
 * @param {(posse_id: string, bag: Object) => void} fn
 * @returns {Function} unsubscribe
 */
function register_posse_state(ns, fn) {
	if (!ns || typeof fn !== "function") return () => {};
	let set = _subscribers.get(ns);
	if (!set) {
		set = new Set();
		_subscribers.set(ns, set);
	}
	set.add(fn);
	return () => {
		set.delete(fn);
		if (set.size === 0) _subscribers.delete(ns);
	};
}

/**
 * Read a namespace's state for a posse from the cache. GM clients that
 * haven't cached yet can pass { authoritative: true } to read the store.
 * @param {string} posse_id
 * @param {string} ns
 * @param {{authoritative?: boolean}} [opts]
 * @returns {Object} the bag ({} when unknown)
 */
function get_posse_state(posse_id, ns, opts = {}) {
	if (!posse_id || !ns) return {};
	if (opts.authoritative && game.user.isGM && game.dc?.posse) {
		return game.dc.posse.get_ext(posse_id, ns);
	}
	return _cache.get(ns)?.get(posse_id) || {};
}

/**
 * Ask the GM to broadcast a posse's state for a namespace. GM clients
 * broadcast immediately (also primes their own cache).
 * @param {string} posse_id
 * @param {string} ns
 */
function request_posse_state(posse_id, ns) {
	if (!posse_id || !ns) return;
	if (game.user.isGM) {
		_broadcast(posse_id, ns);
		return;
	}
	game.socket.emit(SOCKET_CHANNEL, {
		event: "posse_ext_request",
		posse_id,
		ns,
		sender: game.user.id,
	});
}

/**
 * Write a namespace's state bag for a posse — direct posse.set_ext on the
 * GM client (which broadcasts via the ext-change hook), socket round-trip
 * for players.
 * @param {string} posse_id
 * @param {string} ns
 * @param {Object} bag — replacement bag (whole-namespace replace)
 * @returns {Promise<Object|null>} the written bag on the GM direct path,
 *   else null (applied asynchronously by the GM)
 */
async function request_posse_state_write(posse_id, ns, bag) {
	if (!game.dc?.posse) return null;
	if (game.user.isGM) {
		await game.dc.posse.set_ext(posse_id, ns, bag);
		// set_ext fired _on_ext_change → _broadcast; also returns for callers.
		return bag;
	}
	game.socket.emit(SOCKET_CHANNEL, {
		event: "posse_ext_write",
		posse_id,
		ns,
		bag,
		sender: game.user.id,
	});
	return null;
}

// ── Transport ─────────────────────────────────────────────────────

/**
 * GM-side: broadcast one namespace bag to all clients and update the
 * local cache.
 */
function _broadcast(posse_id, ns) {
	if (!posse_id || !ns || !game.dc?.posse) return;
	if (!game.user.isGM) return;
	const bag = game.dc.posse.get_ext(posse_id, ns);
	_apply_local(ns, posse_id, bag);
	game.socket.emit(SOCKET_CHANNEL, { event: "posse_ext_state", posse_id, ns, bag });
}

/**
 * Update the local cache and notify the namespace's subscribers.
 */
function _apply_local(ns, posse_id, bag) {
	if (!ns) return;
	let by_posse = _cache.get(ns);
	if (!by_posse) {
		by_posse = new Map();
		_cache.set(ns, by_posse);
	}
	by_posse.set(posse_id, bag || {});
	const subs = _subscribers.get(ns);
	if (subs) {
		for (const fn of [...subs]) {
			try {
				fn(posse_id, bag || {});
			} catch (err) {
				console.error(`[${MODULE_ID}|posse_state] subscriber for "${ns}" failed:`, err);
			}
		}
	}
}

/**
 * GM-side: apply a player's write request. posse.set_ext re-fires the ext
 * hook, which broadcasts to everyone.
 */
async function _gm_apply_write(data) {
	if (!game.user.isGM || !game.dc?.posse) return;
	await game.dc.posse.set_ext(data.posse_id, data.ns, data.bag);
}

/**
 * Handle incoming socket events on the module channel.
 */
function handle_socket(data) {
	if (!data?.event) return;
	if (data.event === "posse_ext_request") {
		if (game.user.isGM) _broadcast(data.posse_id, data.ns);
	} else if (data.event === "posse_ext_write") {
		void _gm_apply_write(data);
	} else if (data.event === "posse_ext_state") {
		_apply_local(data.ns, data.posse_id, data.bag);
	}
}

/**
 * System-side ext hook dispatcher — fired by posse.set_ext on the GM client
 * after every persist. Broadcasts the changed namespace.
 * @param {string} posse_id
 * @param {string} ns
 */
function _on_system_ext_change(posse_id, ns) {
	_broadcast(posse_id, ns);
}

/**
 * Full registration — call once from dcReady (main.js): socket listener +
 * the posse ext-change hook that triggers broadcasts for every namespace.
 */
function register_posse_state_socket() {
	if (!game.socket) return;
	game.socket.on(SOCKET_CHANNEL, handle_socket);
	if (game.dc?.posse) {
		game.dc.posse._on_ext_change = _on_system_ext_change;
	} else {
		console.warn(`[${MODULE_ID}|posse_state] game.dc.posse unavailable — posse state broadcasts disabled.`);
	}
}

export {
	register_posse_state,
	get_posse_state,
	request_posse_state,
	request_posse_state_write,
	register_posse_state_socket,
};