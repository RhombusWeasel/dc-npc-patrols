/**
 * dialog_editor.js — GM-facing dialog tree editor (ApplicationV2).
 *
 * Left sidebar: list of trees → list of nodes.
 * Right panel: node editor with NPC text + response table.
 * Per response: text, goto dropdown, boons (via system BoonEditor),
 * set_flags, once checkbox.
 *
 * Boons are managed using the system's BoonEditor from
 * systems/Deadlands-Classic/module/sheets/editor.js
 */

import {
	get_trees, save_tree, delete_tree, make_tree, make_response,
} from "./dialog_tree_store.js";

// Static imports from the Deadlands-Classic system (cross-module boundary)
import { get_boon_templates } from "../../../systems/Deadlands-Classic/module/sheets/boon_templates.js";
import { BoonEditor } from "../../../systems/Deadlands-Classic/module/sheets/editor.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "dc-npc-patrols";

export class DialogEditor extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dc-dialog-editor",
		classes: ["dc-dialog-editor-app"],
		tag: "div",
		window: {
			title: "dc-npc-patrols.dialog.editor_title",
			icon: "fa-solid fa-comments",
			resizable: true,
		},
		position: {
			width: 900,
			height: 700,
		},
	};

	static PARTS = {
		main: { template: "modules/dc-npc-patrols/templates/dialog-editor.hbs" },
	};

	// Internal state
	_selected_tree_id = null;
	_selected_node_id = null;
	// In-memory working copy of the selected tree (avoid round-trips on every edit)
	_working_tree = null;

	async _prepareContext(_options) {
		const trees = get_trees();
		const tree_list = Object.values(trees).map((t) => ({
			id: t.id,
			name: t.name || "(unnamed)",
		}));

		let selected_tree = null;
		let node_list = [];
		let selected_node = null;

		if (this._selected_tree_id && trees[this._selected_tree_id]) {
			// Use working copy if available, otherwise clone from store
			if (!this._working_tree || this._working_tree.id !== this._selected_tree_id) {
				this._working_tree = foundry.utils.deepClone(trees[this._selected_tree_id]);
			}
			selected_tree = this._working_tree;

			node_list = Object.values(selected_tree.nodes || {}).map((n) => ({
				id: n.id,
				label: n.id,
			}));

			if (this._selected_node_id && selected_tree.nodes?.[this._selected_node_id]) {
				selected_node = selected_tree.nodes[this._selected_node_id];
				// Pre-compute set_flags as text for editing
				selected_node = foundry.utils.deepClone(selected_node);
				if (selected_node.set_flags) {
					selected_node.set_flags_text = Object.entries(selected_node.set_flags)
						.map(([k, v]) => `${k}=${v}`).join(", ");
				} else {
					selected_node.set_flags_text = "";
				}
				// Also add set_flags_text to each response for the template
				for (const r of selected_node.responses || []) {
					r.set_flags_text = r.set_flags
						? Object.entries(r.set_flags).map(([k, v]) => `${k}=${v}`).join(", ")
						: "";
				}
			}
		}

		return {
			trees: tree_list,
			selected_tree_id: this._selected_tree_id,
			selected_tree,
			node_list,
			selected_node_id: this._selected_node_id,
			selected_node,
		};
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;

		// Tree selection
		html.querySelectorAll("[data-tree-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-tree-delete]")) return;
				this._select_tree(ev.currentTarget.dataset.treeSelect);
			});
		});

		// Tree delete
		html.querySelectorAll("[data-tree-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.treeDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.dialog.delete_tree_confirm"),
				});
				if (!confirmed) return;
				await delete_tree(id);
				if (this._selected_tree_id === id) {
					this._selected_tree_id = null;
					this._selected_node_id = null;
					this._working_tree = null;
				}
				this.render({ force: true });
			});
		});

		// Add tree
		html.querySelector("[data-action='add-tree']")?.addEventListener("click", () => {
			this._add_tree();
		});

		// Node selection
		html.querySelectorAll("[data-node-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				this._selected_node_id = ev.currentTarget.dataset.nodeSelect;
				this.render({ force: true });
			});
		});

		// Add node
		html.querySelector("[data-action='add-node']")?.addEventListener("click", () => {
			this._add_node();
		});

		// Delete node
		html.querySelector("[data-action='delete-node']")?.addEventListener("click", () => {
			this._delete_node();
		});

		// Tree meta fields (name, description, root_node)
		html.querySelectorAll("[data-tree-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const field = el.dataset.treeField;
				if (!this._working_tree) return;
				this._working_tree[field] = el.value;
				this._save_working_tree();
			});
		});

		// Node fields (id, npc_text)
		html.querySelectorAll("[data-node-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const field = el.dataset.nodeField;
				if (!this._working_tree || !this._selected_node_id) return;
				const node = this._working_tree.nodes[this._selected_node_id];
				if (!node) return;

				if (field === "id") {
					// Rename node: update key in nodes object + all goto references
					const new_id = el.value;
					if (this._working_tree.nodes[new_id]) {
						ui.notifications.warn(game.i18n.localize("dc-npc-patrols.dialog.node_id_exists"));
						el.value = node.id;
						return;
					}
					this._rename_node(node.id, new_id);
				} else {
					node[field] = el.value;
				}
				this._save_working_tree();
			});
		});

		// Response fields
		html.querySelectorAll("[data-response-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const [idx_str, field] = el.dataset.responseField.split(":");
				const idx = parseInt(idx_str, 10);
				if (!this._working_tree || !this._selected_node_id) return;
				const node = this._working_tree.nodes[this._selected_node_id];
				const response = node?.responses?.[idx];
				if (!response) return;

				if (field === "once") {
					response.once = el.checked;
				} else if (field === "goto") {
					response.goto = el.value || null;
				} else if (field === "set_flags_text") {
					response.set_flags = _parse_flags(el.value);
				} else if (field === "text") {
					response.text = el.value;
				}
				this._save_working_tree();
			});
		});

		// Response delete
		html.querySelectorAll("[data-response-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const idx = parseInt(el.dataset.responseDelete, 10);
				if (!this._working_tree || !this._selected_node_id) return;
				const node = this._working_tree.nodes[this._selected_node_id];
				if (node?.responses) {
					node.responses.splice(idx, 1);
					this._save_working_tree();
					this.render({ force: true });
				}
			});
		});

		// Add response
		html.querySelector("[data-action='add-response']")?.addEventListener("click", () => {
			this._add_response();
		});

		// Inject boon editors for each response
		this._inject_boon_editors(html);
	}

	// ── Boon editor injection ─────────────────────────────────────────

	async _inject_boon_editors(html) {
		const templates = get_boon_templates();

		const containers = html.querySelectorAll("[data-boon-list]");
		containers.forEach((container) => {
			const idx = parseInt(container.dataset.boonList, 10);
			if (!this._working_tree || !this._selected_node_id) return;
			const node = this._working_tree.nodes[this._selected_node_id];
			const response = node?.responses?.[idx];
			if (!response) return;

			if (!response.boons) response.boons = [];

			// Render boon list table
			container.innerHTML = BoonEditor._render_boon_list_table(response.boons);

			// Add button
			container.querySelector(".boon-list-add")?.addEventListener("click", () => {
				const editor = new BoonEditor(templates, (boon) => {
					response.boons.push(boon);
					this._save_working_tree();
					this._inject_boon_editors(this.element);
				});
				editor.render(true);
			});

			// Edit
			container.querySelectorAll(".boon-list-edit").forEach((btn) => {
				btn.addEventListener("click", () => {
					const boon_idx = parseInt(btn.dataset.idx, 10);
					const editor = new BoonEditor(templates, (updated) => {
						response.boons[boon_idx] = updated;
						this._save_working_tree();
						this._inject_boon_editors(this.element);
					}, { boon: response.boons[boon_idx] });
					editor.render(true);
				});
			});

			// Copy
			container.querySelectorAll(".boon-list-copy").forEach((btn) => {
				btn.addEventListener("click", () => {
					const boon_idx = parseInt(btn.dataset.idx, 10);
					const clone = foundry.utils.deepClone(response.boons[boon_idx]);
					clone.label = `${clone.label || clone.type || "boon"} (Copy)`;
					response.boons.push(clone);
					this._save_working_tree();
					this._inject_boon_editors(this.element);
				});
			});

			// Remove
			container.querySelectorAll(".boon-list-remove").forEach((btn) => {
				btn.addEventListener("click", () => {
					const boon_idx = parseInt(btn.dataset.idx, 10);
					response.boons.splice(boon_idx, 1);
					this._save_working_tree();
					this._inject_boon_editors(this.element);
				});
			});
		});
	}

	// ── Tree / node operations ─────────────────────────────────────────

	_select_tree(id) {
		this._selected_tree_id = id;
		this._selected_node_id = null;
		this._working_tree = null;
		this.render({ force: true });
	}

	async _add_tree() {
		const tree = make_tree("New Tree");
		const saved = await save_tree(tree);
		this._selected_tree_id = saved.id;
		this._selected_node_id = "start";
		this._working_tree = null;
		this.render({ force: true });
	}

	async _add_node() {
		if (!this._working_tree) return;
		const node_id = `node_${Date.now()}`;
		this._working_tree.nodes[node_id] = {
			id: node_id,
			npc_text: "",
			responses: [],
		};
		this._selected_node_id = node_id;
		await this._save_working_tree();
		this.render({ force: true });
	}

	async _delete_node() {
		if (!this._working_tree || !this._selected_node_id) return;
		const nodes = this._working_tree.nodes;
		const node_keys = Object.keys(nodes);
		if (node_keys.length <= 1) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.dialog.cant_delete_last_node"));
			return;
		}

		const confirmed = await foundry.applications.api.DialogV2.confirm({
			content: game.i18n.localize("dc-npc-patrols.dialog.delete_node_confirm"),
		});
		if (!confirmed) return;

		const deleted_id = this._selected_node_id;
		delete nodes[deleted_id];

		// Clean up goto references
		for (const node of Object.values(nodes)) {
			for (const r of node.responses || []) {
				if (r.goto === deleted_id) r.goto = null;
			}
		}
		// Fix root_node if needed
		if (this._working_tree.root_node === deleted_id) {
			this._working_tree.root_node = Object.keys(nodes)[0];
		}

		this._selected_node_id = Object.keys(nodes)[0];
		await this._save_working_tree();
		this.render({ force: true });
	}

	_add_response() {
		if (!this._working_tree || !this._selected_node_id) return;
		const node = this._working_tree.nodes[this._selected_node_id];
		if (!node) return;
		const resp = make_response();
		node.responses = node.responses || [];
		node.responses.push(resp);
		this._save_working_tree();
		this.render({ force: true });
	}

	_rename_node(old_id, new_id) {
		const nodes = this._working_tree.nodes;
		const node = nodes[old_id];
		node.id = new_id;
		nodes[new_id] = node;
		delete nodes[old_id];

		// Update goto references
		for (const n of Object.values(nodes)) {
			for (const r of n.responses || []) {
				if (r.goto === old_id) r.goto = new_id;
			}
		}
		// Update root_node
		if (this._working_tree.root_node === old_id) {
			this._working_tree.root_node = new_id;
		}
		this._selected_node_id = new_id;
	}

	async _save_working_tree() {
		if (!this._working_tree) return;
		await save_tree(foundry.utils.deepClone(this._working_tree));
	}
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Parse "flag1=true, flag2=1" into { flag1: "true", flag2: "1" }.
 * Values are kept as strings (setFlag handles type coercion).
 */
function _parse_flags(text) {
	if (!text || !text.trim()) return {};
	const result = {};
	for (const pair of text.split(",")) {
		const [k, v] = pair.split("=").map((s) => s.trim());
		if (k) result[k] = v ?? true;
	}
	return result;
}