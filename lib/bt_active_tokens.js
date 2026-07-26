/**
 * bt_active_tokens.js — Scene cache of tokens with assigned behaviour trees.
 */

const MODULE_ID = "dc-npc-patrols";

/** @type {Map<string, TokenDocument[]>} */
const _by_scene = new Map();

/**
 * Rebuild the active BT token list for a scene.
 * @param {Scene} scene
 * @returns {TokenDocument[]}
 */
export function rebuild_active_bt_tokens(scene) {
	if (!scene) return [];
	const tokens = [];
	for (const token_doc of scene.tokens) {
		const actor = token_doc.actor;
		if (actor?.getFlag(MODULE_ID, "bt_id")) tokens.push(token_doc);
	}
	_by_scene.set(scene.id, tokens);
	return tokens;
}

/**
 * @param {Scene} scene
 * @returns {TokenDocument[]}
 */
export function get_active_bt_tokens(scene) {
	if (!scene) return [];
	if (!_by_scene.has(scene.id)) return rebuild_active_bt_tokens(scene);
	return _by_scene.get(scene.id);
}

/**
 * @param {string} [scene_id]
 */
export function invalidate_active_bt_tokens(scene_id) {
	if (scene_id) _by_scene.delete(scene_id);
	else _by_scene.clear();
}

function _invalidate_for_actor(actor) {
	if (!actor) return;
	for (const token of actor.getActiveTokens?.() ?? []) {
		invalidate_active_bt_tokens(token.parent?.id);
	}
}

/**
 * Register hooks that keep the active-token cache in sync.
 */
export function register_active_bt_token_hooks() {
	Hooks.on("createToken", (token_doc) => {
		invalidate_active_bt_tokens(token_doc.parent?.id);
	});
	Hooks.on("deleteToken", (token_doc) => {
		invalidate_active_bt_tokens(token_doc.parent?.id);
	});
	Hooks.on("updateActor", (actor, change) => {
		const flags = change.flags?.[MODULE_ID];
		if (flags && "bt_id" in flags) _invalidate_for_actor(actor);
	});
	Hooks.on("canvasReady", () => {
		if (canvas?.scene) rebuild_active_bt_tokens(canvas.scene);
	});
}
