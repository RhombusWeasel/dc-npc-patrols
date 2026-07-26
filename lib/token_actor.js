/**
 * token_actor.js — Resolve actors from scene tokens (linked and unlinked).
 *
 * When a TokenDocument is known, always use token_doc.actor — never substitute
 * game.actors.get() which can return the wrong document for unlinked clones.
 */

export function get_actor_from_token(token_doc) {
  return token_doc?.actor ?? null;
}

/**
 * @param {TokenDocument|null} token_doc
 * @param {Actor|null} actor — fallback when token_doc is missing
 * @returns {Actor|null}
 */
export function resolve_actor_for_token(token_doc, actor = null) {
  if (token_doc) return get_actor_from_token(token_doc);
  if (!actor) return null;
  if (actor.isToken) return actor;
  return game.actors.get(actor.id) ?? actor;
}

export function blackboard_key_for_token(token_doc) {
  return token_doc?.id ?? null;
}

/**
 * @param {Scene|null} scene
 * @param {{ token_id?: string, actor_id?: string }} ids
 * @returns {TokenDocument|null}
 */
export function find_token_doc(scene, { token_id } = {}) {
  if (!scene || !token_id) return null;
  return scene.tokens.get(token_id) ?? null;
}

/**
 * Pixel coordinates of a token's center — used for pathfinding origin and range checks.
 * @param {TokenDocument} token_doc
 * @param {Scene|null} [scene]
 * @returns {{ x: number, y: number }}
 */
export function get_token_center_point(token_doc, scene = null) {
  if (token_doc?.getCenterPoint) {
    return token_doc.getCenterPoint();
  }
  const grid = scene?.grid?.size ?? token_doc?.parent?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  const w = token_doc?.width ?? 1;
  const h = token_doc?.height ?? 1;
  return {
    x: token_doc.x + (w * grid) / 2,
    y: token_doc.y + (h * grid) / 2,
  };
}
