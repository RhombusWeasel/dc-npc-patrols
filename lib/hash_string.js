/**
 * hash_string.js — Fast string hash for cache invalidation keys.
 */

/**
 * @param {string} value
 * @returns {number}
 */
export function hash_string(value) {
	let hash = 5381;
	for (let i = 0; i < value.length; i++) {
		hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
	}
	return hash >>> 0;
}
