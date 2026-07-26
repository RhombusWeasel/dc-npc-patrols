/**
 * hub_scene_cache.js — Cached sidebar NPC token list per scene.
 */

/** @type {Map<string, { id: string, name: string, token_id: string }[]>} */
const _by_scene = new Map();

function _build_npc_tokens(scene) {
  const tokens = [];
  for (const token_doc of scene.tokens) {
    const actor = token_doc.actor;
    if (!actor) continue;
    tokens.push({
      id: actor.id,
      name: token_doc.name || actor.name,
      token_id: token_doc.id,
    });
  }
  return tokens;
}

/**
 * @param {Scene|null} scene
 * @returns {{ id: string, name: string, token_id: string }[]}
 */
export function get_hub_npc_tokens(scene) {
  if (!scene) return [];
  if (!_by_scene.has(scene.id)) {
    _by_scene.set(scene.id, _build_npc_tokens(scene));
  }
  return _by_scene.get(scene.id);
}

/**
 * @param {string} [scene_id]
 */
export function invalidate_hub_scene_cache(scene_id) {
  if (scene_id) _by_scene.delete(scene_id);
  else _by_scene.clear();
}

/**
 * Register hooks that keep the hub sidebar token cache in sync.
 */
export function register_hub_scene_cache_hooks() {
  Hooks.on("createToken", (token_doc) => {
    invalidate_hub_scene_cache(token_doc.parent?.id);
  });
  Hooks.on("deleteToken", (token_doc) => {
    invalidate_hub_scene_cache(token_doc.parent?.id);
  });
  Hooks.on("updateToken", (token_doc) => {
    invalidate_hub_scene_cache(token_doc.parent?.id);
  });
  Hooks.on("canvasReady", () => {
    if (canvas?.scene) get_hub_npc_tokens(canvas.scene);
  });
}
