/**
 * key_socket.js — Socket handler for player key unlock requests.
 *
 * Players lack wall-update permissions, so the GM client performs the
 * authoritative door unlock. The flow is:
 *   1. Player uses a key → use_handler checks adjacency, sends key_unlock_request
 *   2. GM receives request, validates wall_uuid, sets wall ds to CLOSED (unlocked)
 *   3. GM sends key_unlock_complete back to the player
 *
 * Events (socket channel: module.dc-npc-patrols):
 *   key_unlock_request  — Player → GM: wall_uuid to unlock
 *   key_unlock_complete — GM → Player: unlock outcome
 */

const MODULE_ID = "dc-npc-patrols";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;

/**
 * Player-side: request GM to unlock a door wall.
 * @param {string} wall_uuid — Foundry wall UUID
 */
function request_key_unlock(wall_uuid) {
	if (game.user.isGM) {
		// GM can unlock directly — no socket round-trip needed
		void _gm_unlock_wall(wall_uuid, game.user.id);
		return;
	}
	game.socket.emit(SOCKET_CHANNEL, {
		event: "key_unlock_request",
		wall_uuid,
		sender: game.user.id,
	});
}

/**
 * GM-side: unlock a door wall and notify the requesting player.
 * @param {string} wall_uuid
 * @param {string} sender_id — requesting user id
 */
async function _gm_unlock_wall(wall_uuid, sender_id) {
	if (!game.user.isGM) return;

	const wall = await fromUuid(wall_uuid);
	if (!wall?.isDoor) {
		console.warn(`[dc-npc-patrols|key] wall not found or not a door: ${wall_uuid}`);
		_notify_player(sender_id, false, "Door not found.");
		return;
	}

	if (wall.ds !== CONST.WALL_DOOR_STATES.LOCKED) {
		// Already unlocked or open — nothing to do
		_notify_player(sender_id, true, null);
		return;
	}

	try {
		await wall.update({ ds: CONST.WALL_DOOR_STATES.CLOSED });
		_notify_player(sender_id, true, null);
	} catch (err) {
		console.error(`[dc-npc-patrols|key] failed to unlock wall ${wall_uuid}:`, err);
		_notify_player(sender_id, false, "Failed to unlock door.");
	}
}

/**
 * GM-side: send unlock outcome back to the player.
 * @param {string} target_id — player user id
 * @param {boolean} success
 * @param {string|null} error_msg
 */
function _notify_player(target_id, success, error_msg) {
	if (game.user.isGM && target_id !== game.user.id) {
		game.socket.emit(SOCKET_CHANNEL, {
			event: "key_unlock_complete",
			success,
			error: error_msg,
			target: target_id,
		});
	}
}

/**
 * Player-side: handle unlock complete notification from GM.
 * @param {object} data
 */
function _handle_unlock_complete(data) {
	if (game.user.isGM) return;
	if (data.target !== game.user.id) return;

	if (data.success) {
		ui.notifications.info(game.i18n.localize("dc-npc-patrols.key.unlock_success"));
	} else {
		ui.notifications.warn(data.error || game.i18n.localize("dc-npc-patrols.key.unlock_failed"));
	}
}

/**
 * Handle incoming socket events on the module channel.
 * @param {object} data
 */
function handle_socket(data) {
	if (!data?.event) return;

	if (data.event === "key_unlock_request") {
		void _gm_unlock_wall(data.wall_uuid, data.sender);
	} else if (data.event === "key_unlock_complete") {
		_handle_unlock_complete(data);
	}
}

/**
 * Register the socket listener.
 */
function register_socket() {
	if (!game.socket) return;
	game.socket.on(SOCKET_CHANNEL, handle_socket);
}

export { register_socket, request_key_unlock, SOCKET_CHANNEL };