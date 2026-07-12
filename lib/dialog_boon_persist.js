/**
 * dialog_boon_persist.js — write open_shop boon changes back to dialog_trees.
 */

import { save_tree } from "./dialog_tree_store.js";

/**
 * Assign stable shop_id to open_shop boons missing one (GM save time).
 * @param {Object} tree
 */
export function ensure_shop_ids(tree) {
  if (!tree?.id) return;

  for (const node of Object.values(tree.nodes || {})) {
    for (const response of node.responses || []) {
      for (const boon of response.boons || []) {
        if (boon.type === "open_shop" && !boon.shop_id) {
          boon.shop_id = `dcnpc_${tree.id}_${response.id}`;
        }
      }
    }
  }
}

 * @param {Object} tree
 * @param {string} shop_id
 * @param {Object} updated_boon
 * @returns {boolean}
 */
export function update_boon_in_tree(tree, shop_id, updated_boon) {
  if (!tree || !shop_id) return false;

  for (const node of Object.values(tree.nodes || {})) {
    for (const response of node.responses || []) {
      for (const boon of response.boons || []) {
        if (boon.type === "open_shop" && boon.shop_id === shop_id) {
          Object.assign(boon, updated_boon);
          boon.type = "open_shop";
          boon.shop_id = shop_id;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Create a persist_boon callback bound to a dialog tree.
 * @param {Object} tree — live tree reference from ConversationPanel
 * @returns {Function}
 */
export function make_persist_boon(tree) {
  return async (shop_id, updated_boon) => {
    if (!update_boon_in_tree(tree, shop_id, updated_boon)) return false;
    await save_tree(foundry.utils.deepClone(tree));
    return true;
  };
}
