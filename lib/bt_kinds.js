/**
 * bt_kinds.js — Behaviour tree kind constants and normalisation.
 */

export const BT_KIND_TREE = "tree";
export const BT_KIND_FRAGMENT = "fragment";

export function normalize_bt_kind(kind) {
	return kind === BT_KIND_FRAGMENT ? BT_KIND_FRAGMENT : BT_KIND_TREE;
}
