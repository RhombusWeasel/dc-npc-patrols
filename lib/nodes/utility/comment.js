/**
 * comment.js — Utility: Comment
 *
 * A no-op node that is skipped entirely by the engine. Composites filter
 * out `comment` nodes before iterating children, so they never execute,
 * never count toward sequence/selector progress, and never affect the
 * flow of the tree. They exist purely for GM documentation in the editor.
 */

import { register_node } from "../registry.js";

export function register() {
	register_node("comment", {
		category: "utility",
		label: "Comment",
		icon: "fa-solid fa-comment-dots",
		description: "Documentation only — skipped by the engine. Use to annotate sections of your tree.",
		// No tick function — composites filter comment nodes out before
		// iterating, so this is never called. If somehow ticked directly
		// (e.g. as root), return SUCCESS harmlessly.
		tick: async () => "success",
		editor: {
			fields: [
				{ key: "text", type: "text", label: "Comment Text", default: "" },
			],
		},
	});
}