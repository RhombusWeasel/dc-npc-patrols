/**
 * bt_debug.js — Togglable debug logging for the BT engine.
 *
 * Reads the `bt_debug` module setting on each call so it can be turned
 * on/off live from the module config without relogging.  All log output
 * is prefixed with `[dc-npc-patrols]` for easy filtering in the console.
 *
 * Usage:
 *   import { bt_debug_enabled, bt_log, bt_group, bt_group_end } from "./bt_debug.js";
 *   bt_log("tick", `ticked ${n} NPCs`);
 */

const MODULE_ID = "dc-npc-patrols";

/**
 * Whether BT debug logging is currently enabled.
 * @returns {boolean}
 */
export function bt_debug_enabled() {
	try {
		return game?.settings?.get(MODULE_ID, "bt_debug") ?? false;
	} catch {
		return false;
	}
}

/**
 * Log a debug message to the console.  No-op when debug is disabled.
 * @param {string} label — short tag (e.g. "tick", "tick.node", "skip")
 * @param {...any} args — remaining args forwarded to console.log
 */
export function bt_log(label, ...args) {
	if (!bt_debug_enabled()) return;
	console.log(`[dc-npc-patrols|bt:${label}]`, ...args);
}

/**
 * Open a collapsed console.group for a tick cycle.
 * @param {string} label
 * @param {...any} args
 */
export function bt_group(label, ...args) {
	if (!bt_debug_enabled()) return;
	console.groupCollapsed(`[dc-npc-patrols|bt:${label}]`, ...args);
}

/**
 * Close the most recently opened group.
 */
export function bt_group_end() {
	if (!bt_debug_enabled()) return;
	console.groupEnd();
}