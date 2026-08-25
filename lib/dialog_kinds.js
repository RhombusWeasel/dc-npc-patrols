/**
 * dialog_kinds.js — Dialog tree kind constants and normalisation.
 *
 * Mirrors bt_kinds.js: a dialog "tree" is a full conversation; a dialog
 * "fragment" is a reusable subtree that can be inserted (copied) into other
 * trees or linked live via a dialog_ref node.
 */

export const DT_KIND_TREE = "tree";
export const DT_KIND_FRAGMENT = "fragment";

export function normalize_dialog_kind(kind) {
	return kind === DT_KIND_FRAGMENT ? DT_KIND_FRAGMENT : DT_KIND_TREE;
}
