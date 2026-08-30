/**
 * dialog_editor.js — GM-facing dialog tree editor (ApplicationV2).
 *
 * Left sidebar: list of trees → list of nodes.
 * Right panel: node editor with NPC text + response table.
 *
 * Supports fragment composition: a tree may be marked as a Fragment, fragments
 * appear in a draggable palette for Insert (copy), and a tree can Link a
 * fragment via a dialog_ref node. Trees and fragments declare `variables`
 * which resolve per-actor via the hub's dialog_variables overrides.
 */

import {
	get_trees, save_tree, delete_tree, make_tree, make_response,
	get_folders, get_folder, save_folder, delete_folder, make_folder,
} from "./dialog_tree_store.js";
import {
	serialize_dialog_export, parse_dialog_import,
	prepare_imported_dialog, dialog_export_filename,
} from "./dialog_io.js";
import { ensure_shop_ids } from "./dialog_boon_persist.js";
import { get_boon_templates } from "../../../systems/Deadlands-Classic/module/sheets/boon_templates.js";
import { BoonEditor } from "../../../systems/Deadlands-Classic/module/sheets/editor.js";
import { list_dialog_fragments, get_dialog_fragment } from "./dialog_tree_store.js";
import {
	is_dialog_ref, merge_dialog_fragment, make_dialog_ref,
	infer_dialog_variables,
} from "./dialog_fragments.js";
import { normalize_dialog_kind } from "./dialog_kinds.js";
import { get_variable_type_options } from "./nodes/variable_registry.js";
import { default_for_var_type } from "./bt_var_field_ui.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export function create_dialog_editor_state() {
	return {
		selected_tree_id: null,
		selected_node_id: null,
		working_tree: null,
		open_folders: new Set(),
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

/**
 * True when the fragment (transitively) references target_id via dialog_ref
 * nodes. Used to prevent linking a fragment into a tree that would create a
 * cycle.
 * @param {string} frag_id
 * @param {string} target_id
 * @returns {boolean}
 */
function _fragment_references(frag_id, target_id, seen = new Set()) {
	if (!frag_id || seen.has(frag_id)) return false;
	if (frag_id === target_id) return true;
	seen.add(frag_id);
	const frag = get_dialog_fragment(frag_id);
	if (!frag) return false;
	for (const node of Object.values(frag.nodes || {})) {
		if (is_dialog_ref(node) && node.tree_id) {
			if (_fragment_references(node.tree_id, target_id, seen)) return true;
		}
	}
	return false;
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
		const is_ref = is_dialog_ref(n);
		return {
			id: n.id,
			label: n.id,
			is_root: n.id === root_id,
			selected: n.id === selected_node_id,
			is_ref,
			ref_label: is_ref ? get_dialog_fragment(n.tree_id)?.name || n.tree_id || "" : "",
			response_count: (n.responses || []).length,
			preview: is_ref ? "" : (n.npc_text || "").trim().slice(0, 40),
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
		const folders = get_folders();
		const tree_entries = Object.values(trees).map((t) => ({
			id: t.id,
			name: t.name || "(unnamed)",
			is_fragment: normalize_dialog_kind(t.kind) === "fragment",
			folder: t.folder || "",
		}));

		// Build a nested folder tree (arbitrary depth via folder.parent).
		const folder_entries = Object.values(folders).map((f) => ({
			id: f.id,
			name: f.name || "(unnamed)",
			parent: f.parent || "",
			trees: [],
			children: [],
		}));
		const by_id = {};
		for (const fe of folder_entries) by_id[fe.id] = fe;
		for (const te of tree_entries) {
			const parent = by_id[te.folder];
			if (parent) parent.trees.push(te);
		}
		const roots = [];
		for (const fe of folder_entries) {
			const p = fe.parent ? by_id[fe.parent] : null;
			if (p) p.children.push(fe);
			else roots.push(fe);
		}

		// Convert nested folders into recursive render groups. Sub-folders
		// live inside their parent's group so closing a parent hides them.
		const _to_group = (fe) => ({
			is_folder: true,
			folder_id: fe.id,
			folder_name: fe.name,
			trees: fe.trees,
			children: fe.children.map(_to_group),
		});
		const folder_groups = roots.map(_to_group);
		// Unfiled root-level trees/fragments and folders without a parent.
		folder_groups.push({
			is_folder: true,
			is_unfiled: true,
			folder_id: "",
			folder_name: game.i18n.localize("dc-npc-patrols.dialog.folder_unfiled"),
			trees: tree_entries.filter((t) => !by_id[t.folder]),
			children: [],
		});
		const available_fragments = list_dialog_fragments(trees).map((f) => ({
			id: f.id,
			name: f.name || f.id,
		}));
		const fragment_count = available_fragments.length;

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
				selected_node.is_ref = is_dialog_ref(selected_node);
				if (selected_node.is_ref) {
					selected_node.ref_label = get_dialog_fragment(selected_node.tree_id)?.name || selected_node.tree_id || "";
				}
				selected_node.flag_conditions = selected_node.flag_conditions || [];
				selected_node.flag_conditions_else_goto = selected_node.flag_conditions_else_goto || null;
				// Per-row diverts: flatten legacy AND groups (one condition per divert).
				selected_node.diverts = (selected_node.diverts || []).flatMap(d =>
					(d.conditions?.length > 1
						? d.conditions.map(cond => ({ conditions: [cond], goto: d.goto || null }))
						: [{ conditions: d.conditions || [], goto: d.goto || null }])
				);
				if (!selected_node.is_ref) {
					for (const r of selected_node.responses || []) {
						r.set_flags_text = r.set_flags
							? Object.entries(r.set_flags).map(([k, v]) => `${k}=${v}`).join(", ")
							: "";
						r.flag_conditions = r.flag_conditions || [];
						r.set_flags_scope = r.set_flags_scope || "actor";
						for (const cond of r.flag_conditions) {
							cond.scope = cond.scope || "actor";
						}
					}
					for (const cond of selected_node.flag_conditions) {
						cond.scope = cond.scope || "actor";
					}
				}
			}
		}

		return {
			trees: folder_groups,
			selected_tree_id: this.selected_tree_id,
			selected_tree,
			selected_kind: selected_tree ? normalize_dialog_kind(selected_tree.kind) : "tree",
			node_list,
			node_map,
			selected_node_id: this.selected_node_id,
			selected_node,
			available_fragments,
			fragment_count,
			can_link_fragment: Boolean(this.working_tree && this.selected_node_id && available_fragments.length),
		};
	}

	wire_events(html, host) {
		html.querySelectorAll("[data-tree-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-tree-delete]")) return;
				this._select_tree(ev.currentTarget.dataset.treeSelect, host);
			});
		});

		html.querySelectorAll("[data-tree-select]").forEach((el) => {
			el.addEventListener("dragstart", (ev) => {
				ev.dataTransfer.setData("text/plain", JSON.stringify({
					source: "dialog_tree",
					tree_id: el.dataset.treeSelect,
				}));
				ev.dataTransfer.effectAllowed = "move";
				el.classList.add("editor-asset-btn-dragging");
			});
			el.addEventListener("dragend", () => el.classList.remove("editor-asset-btn-dragging"));
		});

		html.querySelectorAll("[data-folder-select]").forEach((el) => {
			el.addEventListener("dragstart", (ev) => {
				// A drag that started on a tree button (a descendant) must not
				// be re-tagged as a folder drag — let the tree payload win.
				if (ev.target.closest("[data-tree-select]")) return;
				ev.dataTransfer.setData("text/plain", JSON.stringify({
					source: "dialog_folder",
					folder_id: el.dataset.folderSelect,
				}));
				ev.dataTransfer.effectAllowed = "move";
				el.classList.add("editor-asset-btn-dragging");
			});
			el.addEventListener("dragend", () => el.classList.remove("editor-asset-btn-dragging"));
			// Preserve open/closed state across re-renders.
			el.addEventListener("toggle", () => {
				const id = el.dataset.folderSelect;
				if (el.open) this.open_folders.add(id);
				else this.open_folders.delete(id);
			});
			// Re-apply the persisted open state after this render.
			if (this.open_folders.has(el.dataset.folderSelect)) el.open = true;
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

		html.querySelector("[data-action='add-fragment']")?.addEventListener("click", () => {
			this._add_fragment(host);
		});

		html.querySelector("[data-action='add-folder']")?.addEventListener("click", () => {
			this._add_folder(host);
		});

		html.querySelectorAll("[data-action='add-subfolder']").forEach((el) => {
			el.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				this._add_folder(host, ev.currentTarget.dataset.addSubfolder);
			});
		});

		html.querySelectorAll("[data-folder-rename]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				this._rename_folder(ev.currentTarget.dataset.folderRename, host);
			});
		});

		html.querySelectorAll("[data-folder-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.folderDelete;
				if (id === "") return;
				const count = Object.values(get_trees()).filter((t) => t.folder === id).length;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.format("dc-npc-patrols.dialog.delete_folder_confirm", { count }),
				});
				if (!confirmed) return;
				await delete_folder(id);
				host.render();
			});
		});


		// Drop targets: folder headers receive dragged tree labels.
		html.querySelectorAll("[data-folder-drop]").forEach((el) => {
			if (el.dataset.wired) return;
			el.dataset.wired = "1";
			el.addEventListener("dragover", (ev) => {
				ev.preventDefault();
				ev.dataTransfer.dropEffect = "move";
				el.classList.add("bt-drop-inside");
			});
			el.addEventListener("dragleave", () => el.classList.remove("bt-drop-inside"));
			el.addEventListener("drop", async (ev) => {
				ev.preventDefault();
				el.classList.remove("bt-drop-inside");
				const target = ev.currentTarget.dataset.folderDrop;
				try {
					const payload = JSON.parse(ev.dataTransfer.getData("text/plain"));
					if (payload?.source === "dialog_tree") {
						const trees = get_trees();
						const tree = trees[payload.tree_id];
						if (tree) {
							tree.folder = target;
							await save_tree(tree);
							host.render();
						}
					} else if (payload?.source === "dialog_folder") {
						const folders = get_folders();
						const folder = folders[payload.folder_id];
						// Reject moving a folder into itself or one of its descendants.
						if (!folder || folder.id === target || this._folder_is_descendant(folder.id, target, folders)) {
							ui.notifications.warn(game.i18n.localize("dc-npc-patrols.dialog.folder_cycle"));
							return;
						}
						folder.parent = target || "";
						await save_folder(folder);
						host.render();
					}
				} catch (e) { /* ignore */ }
			});
		});

		html.querySelector("[data-action='export-tree']")?.addEventListener("click", () => {
			this._export_tree();
		});

		const dialog_import_input = html.querySelector("[data-dialog-import-input]");
		html.querySelector("[data-action='import-tree']")?.addEventListener("click", () => {
			dialog_import_input?.click();
		});
		if (dialog_import_input && !dialog_import_input.dataset.wired) {
			dialog_import_input.dataset.wired = "1";
			dialog_import_input.addEventListener("change", async () => {
				const file = dialog_import_input.files?.[0];
				dialog_import_input.value = "";
				if (file) await this._import_tree(file, host);
			});
		}

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
					if (field === "flag_conditions_else_goto" || field === "tree_id" || field === "return_to") {
						node[field] = el.value || null;
					} else {
						node[field] = el.value;
					}
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
				} else if (field === "set_flags_scope") {
					response.set_flags_scope = el.value;
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

		html.querySelector("[data-action='link-fragment']")?.addEventListener("click", () => {
			const select = html.querySelector("[data-fragment-link-select]");
			const fragment_id = select?.value;
			if (fragment_id) this._link_fragment(fragment_id, host);
		});

		html.querySelectorAll("[data-palette-fragment]").forEach((chip) => {
			chip.setAttribute("draggable", "true");
			chip.addEventListener("dragstart", (ev) => {
				ev.dataTransfer.setData("text/plain", JSON.stringify({
					source: "dialog_fragment",
					fragment_id: chip.dataset.paletteFragment,
				}));
				ev.dataTransfer.effectAllowed = "copy";
				chip.classList.add("bt-palette-chip-dragging");
			});
			chip.addEventListener("dragend", () => chip.classList.remove("bt-palette-chip-dragging"));
		});

		// Drop target = the node structure panel body.
		const drop_target = html.querySelector(".dialog-structure-panel");
		if (drop_target && !drop_target.dataset.wired) {
			drop_target.dataset.wired = "1";
			drop_target.addEventListener("dragover", (ev) => ev.preventDefault());
			drop_target.addEventListener("drop", (ev) => {
				ev.preventDefault();
				try {
					const payload = JSON.parse(ev.dataTransfer.getData("text/plain"));
					if (payload?.source === "dialog_fragment") {
						this._insert_fragment(payload.fragment_id, host);
					}
				} catch (e) { /* ignore */ }
			});
		}

		this._wire_variable_events(html, host);
		this._wire_flag_conditions(html, host);

		this._inject_boon_editors(html, host);
		this._refresh_variable_rows(html);
	}

	_wire_flag_conditions(html, host) {
		// ── Node-level flag conditions ──
		html.querySelectorAll("[data-node-flag-cond-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const [idx_str, field] = el.dataset.nodeFlagCondField.split(":");
				const idx = parseInt(idx_str, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const cond = node?.flag_conditions?.[idx];
				if (!cond) return;
				cond[field] = el.value;
				this._save_working_tree();
			});
		});

		html.querySelectorAll("[data-node-flag-cond-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const idx = parseInt(el.dataset.nodeFlagCondDelete, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				if (node?.flag_conditions) {
					node.flag_conditions.splice(idx, 1);
					this._save_working_tree();
					host.render();
				}
			});
		});

		html.querySelector("[data-action='add-node-flag-cond']")?.addEventListener("click", () => {
			if (!this.working_tree || !this.selected_node_id) return;
			const node = this.working_tree.nodes[this.selected_node_id];
			if (!node) return;
			node.flag_conditions = node.flag_conditions || [];
			node.flag_conditions.push({ flag_key: "", operator: "exists", expected_value: "", scope: "actor" });
			this._save_working_tree();
			host.render();
		});

		// Restore else_goto select value
		if (this.working_tree && this.selected_node_id) {
			const node = this.working_tree.nodes[this.selected_node_id];
			const else_select = html.querySelector("[data-node-field='flag_conditions_else_goto']");
			if (else_select && node?.flag_conditions_else_goto) else_select.value = node.flag_conditions_else_goto;
		}

		// ── Node-level diverts (ordered, first match wins) ──
		html.querySelectorAll("[data-node-divert-cond-field]").forEach((el) => {
			el.addEventListener("change", () => {
				// dataset key "d:d:field" — divert index, condition index, field
				const [div_idx_str, cond_idx_str, field] = el.dataset.nodeDivertCondField.split(":");
				const d_idx = parseInt(div_idx_str, 10);
				const c_idx = parseInt(cond_idx_str, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const cond = node?.diverts?.[d_idx]?.conditions?.[c_idx];
				if (!cond) return;
				cond[field] = el.value;
				this._save_working_tree();
			});
		});

		// (per-row diverts: one condition per divert row, managed by the handlers above)

		html.querySelectorAll("[data-node-divert-goto]").forEach((el) => {
			el.addEventListener("change", () => {
				const d_idx = parseInt(el.dataset.nodeDivertGoto, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const divert = node?.diverts?.[d_idx];
				if (!divert) return;
				divert.goto = el.value || null;
				this._save_working_tree();
			});
		});

		html.querySelectorAll("[data-divert-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const d_idx = parseInt(el.dataset.divertDelete, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				if (node?.diverts) {
					node.diverts.splice(d_idx, 1);
					this._save_working_tree();
					host.render();
				}
			});
		});

		html.querySelectorAll("[data-divert-up], [data-divert-down]").forEach((el) => {
			el.addEventListener("click", () => {
				const up = el.hasAttribute("data-divert-up");
				const d_idx = parseInt(up ? el.dataset.divertUp : el.dataset.divertDown, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const diverts = node?.diverts;
				if (!diverts) return;
				const target = up ? d_idx - 1 : d_idx + 1;
				if (target < 0 || target >= diverts.length) return;
				[diverts[d_idx], diverts[target]] = [diverts[target], diverts[d_idx]];
				this._save_working_tree();
				host.render();
			});
		});

		html.querySelector("[data-action='add-node-divert']")?.addEventListener("click", () => {
			if (!this.working_tree || !this.selected_node_id) return;
			const node = this.working_tree.nodes[this.selected_node_id];
			if (!node) return;
			node.diverts = node.diverts || [];
			node.diverts.push({ conditions: [{ flag_key: "", operator: "exists", expected_value: "", scope: "actor" }], goto: null });
			this._save_working_tree();
			host.render();
		});

		// ── Response-level flag conditions ──
		html.querySelectorAll("[data-response-flag-cond-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const [resp_idx_str, cond_idx_str, field] = el.dataset.responseFlagCondField.split(":");
				const resp_idx = parseInt(resp_idx_str, 10);
				const cond_idx = parseInt(cond_idx_str, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const cond = node?.responses?.[resp_idx]?.flag_conditions?.[cond_idx];
				if (!cond) return;
				cond[field] = el.value;
				this._save_working_tree();
			});
		});

		html.querySelectorAll("[data-response-flag-cond-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const [resp_idx_str, cond_idx_str] = el.dataset.responseFlagCondDelete.split(":");
				const resp_idx = parseInt(resp_idx_str, 10);
				const cond_idx = parseInt(cond_idx_str, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const conds = node?.responses?.[resp_idx]?.flag_conditions;
				if (conds) {
					conds.splice(cond_idx, 1);
					this._save_working_tree();
					host.render();
				}
			});
		});

		html.querySelectorAll("[data-action='add-response-flag-cond']").forEach((el) => {
			el.addEventListener("click", () => {
				const resp_idx = parseInt(el.dataset.responseFlagCondAdd, 10);
				if (!this.working_tree || !this.selected_node_id) return;
				const node = this.working_tree.nodes[this.selected_node_id];
				const response = node?.responses?.[resp_idx];
				if (!response) return;
				response.flag_conditions = response.flag_conditions || [];
				response.flag_conditions.push({ flag_key: "", operator: "exists", expected_value: "", scope: "actor" });
				this._save_working_tree();
				host.render();
			});
		});
	}

	// ── Variable editor ────────────────────────────────────────────
	_render_variable_row_html(var_def, idx) {
		const escape = foundry.utils.escapeHTML;
		const key_ro = var_def.key ? "readonly" : "";
		const type_opts = get_variable_type_options().map((t) =>
			`<option value="${escape(t.id)}"${var_def.type === t.id ? " selected" : ""}>${escape(t.label)}</option>`
		).join("");
		const default_input = var_def.type === "boolean"
			? `<select data-var-field="default"><option value="true"${var_def.default === true || var_def.default === "true" ? " selected" : ""}>True</option><option value="false"${var_def.default === false || var_def.default === "false" ? " selected" : ""}>False</option></select>`
			: `<input type="text" data-var-field="default" value="${escape(String(var_def.default ?? ""))}" placeholder="Default" />`;
		return `<div class="bt-var-row" data-var-index="${idx}">
			<input type="text" data-var-field="key" value="${escape(var_def.key || "")}" placeholder="key" ${key_ro} />
			<input type="text" data-var-field="label" value="${escape(var_def.label || "")}" placeholder="Label" />
			<select data-var-field="type">${type_opts}</select>
			${default_input}
			<button type="button" data-var-delete="${idx}" class="editor-asset-delete"><i class="fa-solid fa-trash"></i></button>
		</div>`;
	}

	_refresh_variable_rows(html) {
		const table = html.querySelector(".bt-variables-table");
		if (!table || !this.working_tree) return;
		const header = table.querySelector(".bt-var-header");
		table.innerHTML = "";
		if (header) table.appendChild(header);
		else {
			const hdr = document.createElement("div");
			hdr.className = "bt-var-row bt-var-header";
			hdr.innerHTML = "<span>Key</span><span>Label</span><span>Type</span><span>Default</span><span></span>";
			table.appendChild(hdr);
		}
		const vars = this.working_tree.variables || [];
		for (let i = 0; i < vars.length; i++) {
			table.insertAdjacentHTML("beforeend", this._render_variable_row_html(vars[i], i));
		}
	}

	_wire_variable_events(html, host) {
		const add_btn = html.querySelector("[data-action='add-variable']");
		if (add_btn && !add_btn.dataset.wired) {
			add_btn.dataset.wired = "1";
			add_btn.addEventListener("click", async () => {
				if (!this.working_tree) return;
				if (!this.working_tree.variables) this.working_tree.variables = [];
				this.working_tree.variables.push({ key: "", label: "", type: "text", default: default_for_var_type("text") });
				await this._save_working_tree();
				this._refresh_variable_rows(html);
				this._wire_variable_events(html, host);
			});
		}

		html.querySelectorAll("[data-var-field]").forEach((el) => {
			if (el.dataset.wired) return;
			el.dataset.wired = "1";
			el.addEventListener("change", async () => {
				if (!this.working_tree) return;
				const row = el.closest("[data-var-index]");
				if (!row) return;
				const idx = parseInt(row.dataset.varIndex, 10);
				const field = el.dataset.varField;
				const var_def = this.working_tree.variables?.[idx];
				if (!var_def) return;
				if (field === "key") {
					var_def.key = el.value.trim().toLowerCase().replace(/\s+/g, "_");
					if (var_def.key) el.readOnly = true;
				} else if (field === "type") {
					var_def.type = el.value;
					var_def.default = default_for_var_type(el.value);
				} else if (field === "default") {
					var_def.default = var_def.type === "boolean" ? el.value === "true" : el.value;
				} else {
					var_def[field] = el.value;
				}
				await this._save_working_tree();
				if (field === "type") {
					this._refresh_variable_rows(html);
					this._wire_variable_events(html, host);
				}
			});
		});

		html.querySelectorAll("[data-var-delete]").forEach((el) => {
			if (el.dataset.wired) return;
			el.dataset.wired = "1";
			el.addEventListener("click", async () => {
				if (!this.working_tree?.variables) return;
				const idx = parseInt(el.dataset.varDelete, 10);
				this.working_tree.variables.splice(idx, 1);
				await this._save_working_tree();
				this._refresh_variable_rows(html);
				this._wire_variable_events(html, host);
			});
		});
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
		this.selected_node_id = saved.root_node;
		this.working_tree = null;
		host.render();
	}

	async _add_fragment(host) {
		const tree = make_tree("New Fragment");
		tree.kind = "fragment";
		const saved = await save_tree(tree);
		this.selected_tree_id = saved.id;
		this.selected_node_id = saved.root_node;
		this.working_tree = null;
		host.render();
	}

	async _add_folder(host, parent = "") {
		const name = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("dc-npc-patrols.dialog.folder_name_prompt") },
			content: `<input name="name" type="text" value="" placeholder="${foundry.utils.escapeHTML(game.i18n.localize("dc-npc-patrols.dialog.folder_name_placeholder"))}" autofocus />`,
			ok: {
				label: "Confirm",
				callback: (_event, button) => button.form.elements.name.value.trim(),
			},
			reject: { label: "Cancel" },
		});
		if (!name || !name.trim()) return;
		const folder = make_folder(name.trim(), parent);
		await save_folder(folder);
		host.render();
	}

	async _rename_folder(id, host) {
		if (!id) return;
		const folder = get_folder(id);
		if (!folder) return;
		const name = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("dc-npc-patrols.dialog.folder_rename_prompt") },
			content: `<input name="name" type="text" value="${foundry.utils.escapeHTML(folder.name || "")}" autofocus />`,
			ok: {
				label: "Confirm",
				callback: (_event, button) => button.form.elements.name.value.trim(),
			},
			reject: { label: "Cancel" },
		});
		if (!name || !name.trim()) return;
		folder.name = name.trim();
		await save_folder(folder);
		host.render();
	}

	/**
	 * True when `candidate` is a descendant of `ancestor` (or equals it).
	 * Used to prevent dragging a folder into its own subtree (a cycle).
	 * @param {string} ancestor
	 * @param {string} candidate
	 * @param {Object<string, Object>} folders
	 * @returns {boolean}
	 */
	_folder_is_descendant(ancestor, candidate, folders) {
		let cur = candidate;
		const seen = new Set();
		while (cur && !seen.has(cur)) {
			if (cur === ancestor) return true;
			seen.add(cur);
			cur = folders[cur]?.parent || "";
		}
		return false;
	}

	async _link_fragment(fragment_id, host) {
		if (!this.working_tree || !this.selected_node_id || !fragment_id) return;
		const fragment = get_dialog_fragment(fragment_id);
		if (!fragment) return;
		// A cycle would form if the fragment (transitively) references the tree
		// we're linking it into.
		if (this.working_tree.id && _fragment_references(fragment.id, this.working_tree.id)) {
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.dialog.fragment_cycle"));
			return;
		}
		const ref = make_dialog_ref(fragment_id);
		ref.id = `ref_${Date.now().toString(36)}`;
		this.working_tree.nodes[ref.id] = ref;
		this.selected_node_id = ref.id;
		await this._save_working_tree();
		ui.notifications.info(game.i18n.format("dc-npc-patrols.dialog.fragment_linked", { name: fragment.name || fragment.id }));
		host.render();
	}

	async _insert_fragment(fragment_id, host) {
		if (!this.working_tree) return;
		const fragment = get_dialog_fragment(fragment_id);
		if (!fragment) return;
		const { root_node, added_nodes } = merge_dialog_fragment(this.working_tree, fragment);
		if (!root_node) return;
		// Point this tree's root at the inserted fragment so it's visible immediately.
		if (!this.working_tree.root_node || !this.working_tree.nodes[this.working_tree.root_node]) {
			this.working_tree.root_node = root_node;
		}
		this.selected_node_id = root_node;
		await this._save_working_tree();
		ui.notifications.info(game.i18n.format("dc-npc-patrols.dialog.fragment_inserted", { name: fragment.name || fragment.id }));
		host.render();
	}

	async _save_selection_as_fragment(host) {
		if (!this.working_tree || !this.selected_node_id) return;
		const node = this.working_tree.nodes[this.selected_node_id];
		if (!node || is_dialog_ref(node)) return;
		const default_name = (node.npc_text || "").trim().slice(0, 30) || this.working_tree.name || "Fragment";
		const name = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("dc-npc-patrols.dialog.fragment_name_prompt") },
			content: `<input name="name" type="text" value="${foundry.utils.escapeHTML(default_name)}" autofocus />`,
			ok: {
				label: "Confirm",
				callback: (_event, button) => button.form.elements.name.value.trim(),
			},
			reject: { label: "Cancel" },
		});
		if (!name) return;

		// Extract the selected node into a new fragment (single node with its own responses).
		const fragment = make_tree(name);
		fragment.kind = "fragment";
		fragment.nodes = {};
		fragment.nodes[node.id] = foundry.utils.deepClone(node);
		fragment.root_node = node.id;
		fragment.variables = infer_dialog_variables(fragment);
		const saved = await save_tree(fragment);
		this.selected_tree_id = saved.id;
		this.selected_node_id = saved.root_node;
		this.working_tree = null;
		ui.notifications.info(game.i18n.format("dc-npc-patrols.dialog.fragment_saved", { name: saved.name }));
		host.render();
	}

	async _add_node(host) {
		if (!this.working_tree) return;
		const node_id = `node_${Date.now()}`;
		this.working_tree.nodes[node_id] = {
			id: node_id,
			npc_text: "",
			responses: [],
			flag_conditions: [],
			flag_conditions_else_goto: null,
			diverts: [],
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

	_export_tree() {
		if (!this.selected_tree_id) return;
		const trees = get_trees();
		const tree = trees[this.selected_tree_id];
		if (!tree) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.dialog.select_tree"));
			return;
		}
		const json = serialize_dialog_export(tree);
		saveDataToFile(json, "application/json", dialog_export_filename(tree));
		ui.notifications.info(
			game.i18n.format("dc-npc-patrols.dialog.export_success", { name: tree.name || tree.id })
		);
	}

	async _import_tree(file, host) {
		try {
			const text = await readTextFromFile(file);
			const tree = parse_dialog_import(text);
			const prepared = prepare_imported_dialog(tree, get_trees());
			const saved = await save_tree(prepared);
			this.selected_tree_id = saved.id;
			this.selected_node_id = saved.root_node || null;
			this.working_tree = null;
			ui.notifications.info(
				game.i18n.format("dc-npc-patrols.dialog.import_success", { name: saved.name })
			);
			host.render();
		} catch (e) {
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.dialog.import_invalid"));
			console.warn("dc-npc-patrols: Dialog tree import failed:", e);
		}
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
			render: () => this.render(),
		});
	}
}
