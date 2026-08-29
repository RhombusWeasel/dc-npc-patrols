/**
 * quest_store.js — World-level CRUD for quest definitions.
 *
 * Quest DEFINITIONS are authored in the Patrol Hub quest editor and stored
 * in a module setting (JSON map keyed by id), like dialog trees. Quest
 * STATE (instances) is per-posse and lives in the posse store — see
 * systems/Deadlands-Classic/module/lib/posse.js and quest_socket.js.
 *
 * Definition shape:
 *   {
 *     id, title, giver, notes,
 *     stages: ["Stage label", ...],        // ordered stage labels
 *     vars: [{ key, type, default }],      // type: "text"|"number"|"boolean"
 *   }
 *
 * Deleting a definition never breaks active quests: instances snapshot the
 * definition at add time (modify_quest boon).
 */

const MODULE_ID = "dc-npc-patrols";

/**
 * Get all quest definitions keyed by id.
 * @returns {Object<string, Object>}
 */
export function get_quest_defs() {
	return game.settings.get(MODULE_ID, "quest_defs") || {};
}

/**
 * Get a single quest definition by id, or null if missing.
 * @param {string} id
 * @returns {Object|null}
 */
export function get_quest_def(id) {
	const defs = get_quest_defs();
	return defs[id] || null;
}

/**
 * Save (create or update) a quest definition. Generates an id if missing.
 * @param {Object} def
 * @returns {Promise<Object>} the saved definition (with id)
 */
export async function save_quest_def(def) {
	const defs = get_quest_defs();
	if (!def.id) {
		def.id = _generate_id("qdef");
	}
	defs[def.id] = def;
	await game.settings.set(MODULE_ID, "quest_defs", defs);
	return def;
}

/**
 * Delete a quest definition by id. Posse quest instances keep their
 * snapshot — this only removes the authoring definition.
 * @param {string} id
 */
export async function delete_quest_def(id) {
	const defs = get_quest_defs();
	delete defs[id];
	await game.settings.set(MODULE_ID, "quest_defs", defs);
}

/**
 * Create a new empty quest definition object (not yet saved).
 * @param {string} [title="New Quest"]
 * @returns {Object}
 */
export function make_quest_def(title = "New Quest") {
	return {
		id: "",
		title,
		giver: "",
		notes: "",
		stages: [],
		vars: [],
	};
}

// ── Helpers ───────────────────────────────────────────────────────

function _generate_id(prefix) {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}