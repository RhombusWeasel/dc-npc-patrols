/**
 * time_gate.js — Check whether the current campaign time falls within
 * a specified time window.
 *
 * Supports overnight windows (e.g. "18:00"–"06:00").
 * Uses game.dc.utils.get_date() for campaign-local time.
 */

/**
 * Convert "HH:MM" to minutes-since-midnight.
 * @param {string|null|undefined} time_str
 * @returns {number|null}
 */
function _to_minutes(time_str) {
	if (!time_str) return null;
	const [h, m] = time_str.split(":").map(Number);
	if (isNaN(h) || isNaN(m)) return null;
	return h * 60 + m;
}

/**
 * Check if the current campaign time is within [time_start, time_end).
 *
 * - If either bound is null, the window is "always open" (returns true).
 * - Handles overnight windows where time_end < time_start
 *   (e.g. 18:00–06:00 means active from 6pm to 6am).
 *
 * @param {string|null} time_start — "HH:MM" or null
 * @param {string|null} time_end   — "HH:MM" or null
 * @returns {boolean}
 */
export function is_in_time_window(time_start, time_end) {
	const start = _to_minutes(time_start);
	const end = _to_minutes(time_end);

	// No window defined → always active
	if (start === null && end === null) return true;
	if (start === null || end === null) return true;

	const date = game.dc.utils.time.get_date();
	const now = parseInt(date.hour) * 60 + parseInt(date.minute);

	// Normal window: start <= end (e.g. 06:00–18:00)
	if (start <= end) {
		return now >= start && now < end;
	}

	// Overnight window: end < start (e.g. 18:00–06:00)
	return now >= start || now < end;
}

/**
 * Return a coarse time-of-day label for placeholder substitution.
 * @returns {string} — "morning" | "afternoon" | "evening" | "night"
 */
export function get_time_of_day() {
	const date = game.dc.utils.time.get_date();
	const h = parseInt(date.hour);
	if (h >= 5 && h < 12) return "morning";
	if (h >= 12 && h < 17) return "afternoon";
	if (h >= 17 && h < 21) return "evening";
	return "night";
}