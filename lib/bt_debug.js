/**
 * bt_debug.js — Togglable debug logging and optional tick perf stats.
 */

const MODULE_ID = "dc-npc-patrols";
const PERF_SLOW_MS = 500;

let _perf = null;

export function bt_debug_enabled() {
	try {
		return game?.settings?.get(MODULE_ID, "bt_debug") ?? false;
	} catch {
		return false;
	}
}

export function bt_log(label, ...args) {
	if (!bt_debug_enabled()) return;
	console.log(`[dc-npc-patrols|bt:${label}]`, ...args);
}

export function bt_group(label, ...args) {
	if (!bt_debug_enabled()) return;
	console.groupCollapsed(`[dc-npc-patrols|bt:${label}]`, ...args);
}

export function bt_group_end() {
	if (!bt_debug_enabled()) return;
	console.groupEnd();
}

export function bt_perf_begin_tick() {
	if (!bt_debug_enabled()) return;
	_perf = {
		start_ms: performance.now(),
		path_cache_hits: 0,
		path_cache_misses: 0,
	};
}

export function bt_perf_path_cache_hit() {
	if (_perf) _perf.path_cache_hits++;
}

export function bt_perf_path_cache_miss() {
	if (_perf) _perf.path_cache_misses++;
}

/**
 * @param {number} active_count
 * @param {number} ticked_count
 */
export function bt_perf_end_tick(active_count, ticked_count) {
	if (!bt_debug_enabled() || !_perf) return;

	const duration_ms = performance.now() - _perf.start_ms;
	const summary = {
		duration_ms: Math.round(duration_ms),
		active_npcs: active_count,
		ticked: ticked_count,
		path_hits: _perf.path_cache_hits,
		path_misses: _perf.path_cache_misses,
	};

	if (duration_ms >= PERF_SLOW_MS) {
		bt_log("perf.slow", summary);
	} else {
		bt_log("perf", summary);
	}

	_perf = null;
}
