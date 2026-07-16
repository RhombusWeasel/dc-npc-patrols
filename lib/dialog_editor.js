/**
 * dialog_editor.js — GM-facing dialog tree editor (ApplicationV2).
 *
 * Left sidebar: list of trees → list of nodes.
 * Right panel: node editor with NPC text + response table.
 */

import {
	get_trees, save_tree, delete_tree, make_tree, make_response,
} from "./dialog_tree_store.js";
import { ensure_shop_ids } from "./dialog_boon_persist.js";
import { get_boon_templates } from "../../../systems/Deadlands-Classic/module/sheets/boon_templates.js";
import { BoonEditor } from "../../../systems/Deadlands-Classic/module/sheets/editor.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export function create_dialog_editor_state() {
	return {
		selected_tree_id: null,
		selected_node_id: null,
		working_tree: null,
	};
}

function _parse_flags(text) {
	if (!text || !text.trim()) return {};
	const result = {};
	for (const pair of text.split(",")) {
		const [k, v] = pair.split("=").map((s) => s.trim());
		if (k) result[k] = v ?? true;
	}
	return result;
}

function _build_node_map(tree, selected_node_id) {
	const nodes = tree.nodes || {};
	const root_id = tree.root_node;
	const incoming = {};

	for (const node of Object.values(nodes)) {
		for (const r of node.responses || []) {
			if (!r.goto) continue;
			if (!incoming[r.goto]) incoming[r.goto] = [];
			if (!incoming[r.goto].includes(node.id)) incoming[r.goto].push(node.id);
		}
	}

	return Object.values(nodes).map((n) => {
		const goto_ids = new Set();
		const goto_targets = [];
		for (const r of n.responses || []) {
			if (r.goto && !goto_ids.has(r.goto)) {
				goto_ids.add(r.goto);
				goto_targets.push({ id: r.goto, label: nodes[r.goto]?.id || r.goto });
			}
		}
		return {
			id: n.id,
			label: n.id,
			is_root: n.id === root_id,
			selected: n.id === selected_node_id,
			response_count: (n.responses || []).length,
			preview: (n.npc_text || "").trim().slice(0, 40),
			goto_targets,
			incoming_from: (incoming[n.id] || []).map((id) => ({ id, label: id })),
		};
	});
}

export class DialogEditorController {
	constructor() {
		Object.assign(this, create_dialog_editor_state());
	}

	async prepare_context() {
		const trees = get_trees();
		const tree_list = Object.values(trees).map((t) => ({
			id: t.id,
			name: t.name || "(unnamed)",
		}));

		let selected_tree = null;
		let node_list = [];
		let node_map = [];
		let selected_node = null;

		if (this.selected_tree_id && trees[this.selected_tree_id]) {
			if (!this.working_tree || this.working_tree.id !== this.selected_tree_id) {
				this.working_tree = foundry.utils.deepClone(trees[this.selected_tree_id]);
			}
			selected_tree = this.working_tree;

			node_list = Object.values(selected_tree.nodes || {}).map((n) => ({
				id: n.id,
				label: n.id,
			}));

			node_map = _build_node_map(selected_tree, this.selected_node_id);

			if (this.selected_node_id && selected_tree.nodes?.[this.selected_node_id]) {
				selected_node = foundry.utils.deepClone(selected_tree.nodes[this.selected_node_id]);
				for (const r of selected_node.responses || []) {
					r.set_flags_text = r.set_flags
						? Object.entries(r.set_flags).map(([k, v]) => `${k}=${v}`).join(", ")
						: "";
				}
			}
		}

		return {
			trees: tree_list,
			selected_tree_id: this.selected_tree_id,
			selected_tree,
			node_list,
			node_map,
			selected_node_id: this.selected_node_id,
			selected_node,
		};
	}

	wire_events(html, host) {
		html.querySelectorAll("[data-tree-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-tree-delete]")) return;
				this._select_tree(ev.currentTarget.dataset.treeSelect, host);
			});
		});

		html.querySelectorAll("[data-tree-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.treeDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.dialog.delete_tree_confirm"),
				});
				if (!confirmed) return;
				await delete_tree(id);
				if (this.selected_tree_id === id) {
					this.selected_tree_id = null;
					this.selected_node_id = null;
					this.working_tree = null;
				}
				host.render();
			});
		});

		html.querySelector("[data-action='add-tree']")?.addEventListener("click", () => {
			this._add_tree(host);
		});

		html.querySelectorAll("[data-node-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				this.selected_node_id = ev.currentTarget.dataset.nodeSelect;
				host.render();
			});
		});

		html.querySelector("[data-action='add-node']")?.addEventListener("click", () => {
			this._add_node(host);
		});

		html.querySelector("[data-action='delete-node']")?.addEventListener("click", () => {
			this._delete_node(host);
		});

		html.querySelectorAll("[data-tree-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const field = el.dataset.treeField;
				if (!this.working_tree) return;
				this.working_tree[field] = el.value;
				this._save_working_tree();
			});
		});

		html.querySelectorAll("[data-node-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const field = el.dataset.nodeField;
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				if (!node) return;

				if (field === "id") {
					const new_id = el.value;
					if (this.working_tree.nodes[new_id]) {
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

		html.querySelectorAll("[data-response-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const [idx_str, field] = el.dataset.responseField.split(":");
				const idx = parseInt(idx_str, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
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

		if (this.working_tree && this.selected_node_id) {
			const node = this.working_tree.nodes[this.selected_node_id];
			for (const [idx_str, resp] of Object.entries(node?.responses || [])) {
				const select = html.querySelector(`[data-response-field="${idx_str}:goto"]`);
				if (select && resp.goto) select.value = resp.goto;
			}
		}

		html.querySelectorAll("[data-response-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const idx = parseInt(el.dataset.responseDelete, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				if (node?.responses) {
					node.responses.splice(idx, 1);
					this._save_working_tree();
					host.render();
				}
			});
		});

		html.querySelector("[data-action='add-response']")?.addEventListener("click", () => {
			this._add_response(host);
		});

		this._inject_boon_editors(html, host);
	}

	_inject_boon_editors(html, host) {
		const templates = get_boon_templates();

		html.querySelectorAll("[data-boon-list]").forEach((container) => {
			const idx = parseInt(container.dataset.boonList, 10);
			if (!this.working_tree || !this.selected_node_id) return;
			const node = this.working_tree.nodes[this.selected_node_id];
			const response = node?.responses?.[idx];
			if (!response) return;

			if (!response.boons) response.boons = [];

			container.innerHTML = BoonEditor._render_boon_list_table(response.boons);

			container.querySelector(".boon-list-add")?.addEventListener("click", () => {
				const editor = new BoonEditor(templates, (boon) => {
					response.boons.push(boon);
					this._save_working_tree();
					this._inject_boon_editors(host.element, host);
				});
				editor.render(true);
			});

			container.querySelectorAll(".boon-list-edit").forEach((btn) => {
				btn.addEventListener("click", () => {
					const boon_idx = parseInt(btn.dataset.idx, 10);
					const editor = new BoonEditor(templates, (updated) => {
						response.boons[boon_idx] = updated;
						this._save_working_tree();
						this._inject_boon_editors(host.element, host);
					}, { boon: response.boons[boon_idx] });
					editor.render(true);
				});
			});

			container.querySelectorAll(".boon-list-copy").forEach((btn) => {
				btn.addEventListener("click", () => {
					const boon_idx = parseInt(btn.dataset.idx, 10);
					const clone = foundry.utils.deepClone(response.boons[boon_idx]);
					clone.label = `${clone.label || clone.type || "boon"} (Copy)`;
					response.boons.push(clone);
					this._save_working_tree();
					this._inject_boon_editors(host.element, host);
				});
			});

			container.querySelectorAll(".boon-list-remove").forEach((btn) => {
				btn.addEventListener("click", () => {
					const boon_idx = parseInt(btn.dataset.idx, 10);
					response.boons.splice(boon_idx, 1);
					this._save_working_tree();
					this._inject_boon_editors(host.element, host);
				});
			});
		});
	}

	_select_tree(id, host) {
		this.selected_tree_id = id;
		this.selected_node_id = null;
		this.working_tree = null;
		host.render();
	}

	select_tree(id, host) {
		this._select_tree(id, host);
	}

	async _add_tree(host) {
		const tree = make_tree("New Tree");
		const saved = await save_tree(tree);
		this.selected_tree_id = saved.id;
		this.selected_node_id = "start";
		this.working_tree = null;
		host.render();
	}

	async _add_node(host) {
		if (!this.working_tree) return;
		const node_id = `node_${Date.now()}`;
		this.working_tree.nodes[node_id] = {
			id: node_id,
			npc_text: "",
			responses: [],
		};
		this.selected_node_id = node_id;
		await this._save_working_tree();
		host.render();
	}

	async _delete_node(host) {
		if (!this.working_tree || !this.selected_node_id) return;
		const nodes = this.working_tree.nodes;
		if (Object.keys(nodes).length <= 1) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.dialog.cant_delete_last_node"));
			return;
		}

		const confirmed = await foundry.applications.api.DialogV2.confirm({
			content: game.i18n.localize("dc-npc-patrols.dialog.delete_node_confirm"),
		});
		if (!confirmed) return;

		const deleted_id = this.selected_node_id;
		delete nodes[deleted_id];

		for (const node of Object.values(nodes)) {
			for (const r of node.responses || []) {
				if (r.goto === deleted_id) r.goto = null;
			}
		}
		if (this.working_tree.root_node === deleted_id) {
			this.working_tree.root_node = Object.keys(nodes)[0];
		}

		this.selected_node_id = Object.keys(nodes)[0];
		await this._save_working_tree();
		host.render();
	}

	_add_response(host) {
		if (!this.working_tree || !this.selected_node_id) return;
		const node = this.working_tree.nodes[this.selected_node_id];
		if (!node) return;
		node.responses = node.responses || [];
		node.responses.push(make_response());
		this._save_working_tree();
		host.render();
	}

	_rename_node(old_id, new_id) {
		const nodes = this.working_tree.nodes;
		const node = nodes[old_id];
		node.id = new_id;
		nodes[new_id] = node;
		delete nodes[old_id];

		for (const n of Object.values(nodes)) {
			for (const r of n.responses || []) {
				if (r.goto === old_id) r.goto = new_id;
			}
		}
		if (this.working_tree.root_node === old_id) {
			this.working_tree.root_node = new_id;
		}
		this.selected_node_id = new_id;
	}

	async _save_working_tree() {
		if (!this.working_tree) return;
		ensure_shop_ids(this.working_tree);
		await save_tree(foundry.utils.deepClone(this.working_tree));
	}
}

export async function prepare_dialog_context(state) {
	const ctrl = state instanceof DialogEditorController ? state : Object.assign(new DialogEditorController(), state);
	return ctrl.prepare_context();
}

export function wire_dialog_events(state, html, host) {
	const ctrl = state instanceof DialogEditorController ? state : Object.assign(new DialogEditorController(), state);
	ctrl.wire_events(html, host);
}

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

	_ctrl = new DialogEditorController();

	async _prepareContext(_options) {
		return this._ctrl.prepare_context();
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		this._ctrl.wire_events(this.element, {
			element: this.element,
			render: () => this.render({ force: true }),
		});
	}
}
