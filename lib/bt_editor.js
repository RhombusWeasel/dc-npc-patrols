/**
 * bt_editor.js — GM-facing behaviour tree editor (ApplicationV2).
 */

import { get_bts, get_bt, save_bt, delete_bt, make_bt } from "./bt_store.js";
import { NODE_REGISTRY } from "./bt_nodes.js";
import { get_equip_slot_options } from "./gear_actions.js";
import {
	serialize_bt_export,
	parse_bt_import,
	validate_bt_tree,
	prepare_imported_tree,
	export_filename,
} from "./bt_io.js";
import {
	BT_KIND_FRAGMENT,
	BT_KIND_TREE,
	normalize_bt_kind,
	list_fragments,
	clone_subtree,
	extract_selection,
	merge_variables,
	infer_variables_for_node,
	make_subtree_node,
	would_create_cycle,
	collect_variable_defs,
} from "./bt_subtree.js";
import { repair_misplaced_child_nodes } from "./bt_tree_repair.js";
import { get_door_options } from "./bt_variables.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let _node_id_counter = 0;
function _gen_node_id() {
	return `n${++_node_id_counter}_${Date.now().toString(36).slice(-4)}`;
}

const VARIABLE_TYPES = ["text", "number", "boolean", "waypoint_select", "region_select", "foundry_id"];

function _assign_ids(node) {
	if (!node) return;
	if (!node._id) node._id = _gen_node_id();
	if (node._label === undefined) node._label = "";
	if (node.children) for (const c of node.children) _assign_ids(c);
	if (node.child) _assign_ids(node.child);
}

function _find_node(root, id, parent = null, key = null) {
	if (root._id === id) return { node: root, parent, key };
	if (root.children) {
		for (let i = 0; i < root.children.length; i++) {
			const result = _find_node(root.children[i], id, root, i);
			if (result) return result;
		}
	}
	if (root.child) {
		const result = _find_node(root.child, id, root, "child");
		if (result) return result;
	}
	return null;
}

function _flatten(root, level = 0, result = [], opts = {}) {
	if (!root) return result;
	const def = NODE_REGISTRY[root.type];
	const is_preview = opts.preview ?? false;
	result.push({
		_id: root._id,
		type: root.type,
		label: root._label || def?.label || root.type,
		summary: _get_node_summary(root),
		category: def?.category || "unknown",
		icon: def?.icon || "fa-solid fa-circle",
		level,
		is_preview,
	});
	if (root.type === "subtree" && root.bt_id) {
		const fragment = get_bt(root.bt_id);
		if (fragment?.root) {
			_flatten(fragment.root, level + 1, result, { preview: true });
		}
		return result;
	}
	if (root.children) {
		for (const c of root.children) _flatten(c, level + 1, result, opts);
	}
	if (root.child) _flatten(root.child, level + 1, result, opts);
	return result;
}

function _init_node_defaults(node) {
	const fields = _get_node_fields(node);
	for (const field of fields) {
		if (node[field.key] === undefined && field.default !== undefined) {
			node[field.key] = field.default;
		}
	}
}

function _get_node_summary(node) {
	if (node.type === "subtree") {
		const fragment = get_bt(node.bt_id);
		if (!fragment) {
			return game.i18n.localize("dc-npc-patrols.bt.fragment_missing");
		}
		return `→ ${fragment.name || fragment.id}`;
	}
	if (node.type === "condition_time") {
		const start = node.start_time || "06:00";
		const end = node.end_time || "22:00";
		return `${start}–${end}`;
	}
	const fields = _get_node_fields(node);
	for (const field of fields) {
		const val = node[field.key];
		if (val === undefined || val === null || val === "") continue;
		const display = Array.isArray(val) ? val.join(",") : String(val);
		if (!display) continue;
		return `${field.label}: ${display}`.slice(0, 48);
	}
	return "";
}

function _get_node_path(root, target_id, path = []) {
	if (!root) return null;
	const def = NODE_REGISTRY[root.type];
	const entry = {
		_id: root._id,
		label: root._label || def?.label || root.type,
	};
	const current_path = [...path, entry];
	if (root._id === target_id) return current_path;
	if (root.children) {
		for (const c of root.children) {
			const result = _get_node_path(c, target_id, current_path);
			if (result) return result;
		}
	}
	if (root.child) {
		const result = _get_node_path(root.child, target_id, current_path);
		if (result) return result;
	}
	return null;
}

function _node_label(node) {
	const def = NODE_REGISTRY[node.type];
	if (node._label) return node._label;
	return def?.label || node.type;
}

function _prepare_tree_view(root, selected_node_id) {
	const flat = _flatten(root);
	return flat.map((n) => ({
		...n,
		selected: n._id === selected_node_id,
		indent: n.level * 20,
	}));
}

function _get_node_fields(node) {
	const def = NODE_REGISTRY[node.type];
	return def?.editor?.fields || [];
}

function _get_field_value(node, field) {
	const val = node[field.key];
	if (field.type === "boolean") {
		if (val === undefined || val === null) return field.default ?? false;
		return val === true || val === "true";
	}
	if (val === undefined || val === null) return field.default ?? "";
	if (Array.isArray(val)) return val.join(",");
	return val;
}

function _get_node_type_options() {
	const categories = { composite: [], decorator: [], condition: [], action: [] };
	for (const [type, def] of Object.entries(NODE_REGISTRY)) {
		const cat = def.category || "action";
		if (!categories[cat]) categories[cat] = [];
		categories[cat].push({ type, label: def.label || type });
	}
	return categories;
}

function _filter_bts_for_asset_panel(bts, asset_filter) {
	const all = Object.values(bts).map((t) => ({
		id: t.id,
		name: t.name || "(unnamed)",
		kind: normalize_bt_kind(t.kind),
		is_fragment: normalize_bt_kind(t.kind) === BT_KIND_FRAGMENT,
	}));
	if (asset_filter === "tree") {
		return all.filter((t) => t.kind === BT_KIND_TREE);
	}
	if (asset_filter === "fragment") {
		return all.filter((t) => t.is_fragment);
	}
	return all;
}

async function _prompt_fragment_name(default_name = "") {
	const escape = foundry.utils.escapeHTML;
	try {
		return await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("dc-npc-patrols.bt.fragment_name_prompt") },
			content: `<input name="name" type="text" value="${escape(default_name)}" autofocus />`,
			ok: {
				label: game.i18n.localize("Confirm"),
				callback: (_event, button) => button.form.elements.name.value.trim(),
			},
		});
	} catch {
		return null;
	}
}

function _insert_node_as_child(found, new_node) {
	const def = NODE_REGISTRY[found.node.type];
	if (def?.category === "composite") {
		found.node.children ??= [];
		found.node.children.push(new_node);
		return;
	}
	if (def?.category === "decorator") {
		found.node.child = new_node;
		return;
	}
	if (found.parent?.children) {
		found.parent.children.splice(found.key + 1, 0, new_node);
	}
}

export function create_bt_editor_state() {
	return {
		selected_bt_id: null,
		selected_node_id: null,
		working_bt: null,
		asset_filter: "all",
		_settings_panel_open: { tree: false, variables: false },
	};
}

export class BTEditorController {
	constructor() {
		Object.assign(this, create_bt_editor_state());
	}

	async prepare_context() {
		const bts = get_bts();
		const bt_list = _filter_bts_for_asset_panel(bts, this.asset_filter || "all");
		const fragments = list_fragments(bts).map((t) => ({
			id: t.id,
			name: t.name || "(unnamed)",
		}));
		let selected_kind = normalize_bt_kind(this.working_bt?.kind);

		let selected_bt = null;
		let tree_nodes = [];
		let selected_node = null;
		let node_label = "";
		let node_fields = [];
		let node_field_values = {};
		let node_breadcrumb = [];
		let selected_node_category = "";
		let selected_node_icon = "";
		let selected_node_is_root = false;

		if (this.selected_bt_id && bts[this.selected_bt_id]) {
			if (!this.working_bt || this.working_bt.id !== this.selected_bt_id) {
				this.working_bt = foundry.utils.deepClone(bts[this.selected_bt_id]);
				this.working_bt.kind = normalize_bt_kind(this.working_bt.kind);
				repair_misplaced_child_nodes(this.working_bt.root);
				_assign_ids(this.working_bt.root);
			}
			selected_bt = this.working_bt;
			selected_kind = normalize_bt_kind(selected_bt.kind);

			tree_nodes = _prepare_tree_view(selected_bt.root, this.selected_node_id);

			if (this.selected_node_id) {
				const found = _find_node(selected_bt.root, this.selected_node_id);
				if (found) {
					selected_node = found.node;
					selected_node_is_root = found.parent === null;
					node_label = _node_label(selected_node);
					node_fields = _get_node_fields(selected_node);
					if (selected_node.type === "action_equip_item") {
						for (const field of node_fields) {
							if (field.key === "equip_slot") field.options = get_equip_slot_options();
						}
					}
					node_field_values = {};
					for (const field of node_fields) {
						node_field_values[field.key] = _get_field_value(selected_node, field);
					}
					node_breadcrumb = _get_node_path(selected_bt.root, this.selected_node_id) || [];
					const def = NODE_REGISTRY[selected_node.type];
					selected_node_category = def?.category || "unknown";
					selected_node_icon = def?.icon || "fa-solid fa-circle";
				}
			}
		}

		const node_types = _get_node_type_options();
		const var_defs = selected_bt?.id
			? collect_variable_defs(selected_bt.id)
			: (selected_bt?.variables || []);
		const var_keys = new Set(var_defs.map((v) => v.key).filter(Boolean));

		if (selected_node) {
			for (const field of node_fields) {
				const val = node_field_values[field.key];
				if (typeof val === "string" && val.includes("{{")) {
					const refs = [...val.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
					field._var_refs = refs.map((name) => ({
						name,
						declared: var_keys.has(name),
					}));
				} else {
					field._var_refs = [];
				}
			}
		}

		return {
			bts: bt_list,
			fragments,
			asset_filter: this.asset_filter || "all",
			selected_bt_id: this.selected_bt_id,
			selected_bt,
			selected_kind,
			can_insert_fragment: Boolean(this.working_bt && this.selected_node_id && fragments.length),
			can_link_fragment: Boolean(this.working_bt && this.selected_node_id && fragments.length),
			can_save_as_fragment: Boolean(this.working_bt && this.selected_node_id),
			tree_nodes,
			selected_node_id: this.selected_node_id,
			selected_node,
			node_label,
			node_fields,
			node_field_values,
			node_breadcrumb,
			selected_node_category,
			selected_node_icon,
			selected_node_is_root,
			node_types,
			var_types: VARIABLE_TYPES,
		};
	}

	wire_events(html, host) {
		html.querySelectorAll("[data-bt-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-bt-delete]")) return;
				this._select_bt(ev.currentTarget.dataset.btSelect, host);
			});
		});

		html.querySelectorAll("[data-bt-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.btDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.bt.delete_confirm"),
				});
				if (!confirmed) return;
				await delete_bt(id);
				if (this.selected_bt_id === id) {
					this.selected_bt_id = null;
					this.selected_node_id = null;
					this.working_bt = null;
				}
				host.render();
			});
		});

		html.querySelector("[data-action='add-bt']")?.addEventListener("click", () => {
			this._add_bt(host);
		});

		html.querySelector("[data-action='add-fragment']")?.addEventListener("click", () => {
			this._add_bt(host, BT_KIND_FRAGMENT);
		});

		html.querySelectorAll("[data-asset-filter]").forEach((el) => {
			el.addEventListener("click", () => {
				this.asset_filter = el.dataset.assetFilter;
				host.render();
			});
		});

		html.querySelector("[data-action='insert-fragment']")?.addEventListener("click", () => {
			const select = html.querySelector("[data-fragment-select]");
			const fragment_id = select?.value;
			if (fragment_id) this._insert_fragment(fragment_id, host);
		});

		html.querySelector("[data-action='link-fragment']")?.addEventListener("click", () => {
			const select = html.querySelector("[data-fragment-select]");
			const fragment_id = select?.value;
			if (fragment_id) this._link_fragment(fragment_id, host);
		});

		html.querySelector("[data-action='save-as-fragment']")?.addEventListener("click", () => {
			this._save_selection_as_fragment(host);
		});

		html.querySelector("[data-action='export-bt']")?.addEventListener("click", () => {
			this._export_bt();
		});

		const import_input = html.querySelector("[data-bt-import-input]");
		html.querySelector("[data-action='import-bt']")?.addEventListener("click", () => {
			import_input?.click();
		});
		if (import_input && !import_input.dataset.wired) {
			import_input.dataset.wired = "1";
			import_input.addEventListener("change", async () => {
				const file = import_input.files?.[0];
				import_input.value = "";
				if (!file) return;
				await this._import_bt(file, host);
			});
		}

		html.querySelectorAll("[data-bt-field]").forEach((el) => {
			el.addEventListener("change", async () => {
				const field = el.dataset.btField;
				if (!this.working_bt) return;
				this.working_bt[field] = el.value;
				if (field === "kind") {
					this.working_bt.kind = normalize_bt_kind(el.value);
				}
				await this._save_working_bt();
				host.render();
			});
		});

		html.querySelectorAll("[data-node-id]").forEach((el) => {
			el.addEventListener("click", () => {
				this.selected_node_id = el.dataset.nodeId;
				host.render();
			});
		});

		html.querySelectorAll("[data-breadcrumb-select]").forEach((el) => {
			el.addEventListener("click", () => {
				this.selected_node_id = el.dataset.breadcrumbSelect;
				host.render();
			});
		});

		html.querySelector("[data-node-label]")?.addEventListener("change", (el) => {
			if (!this.working_bt || !this.selected_node_id) return;
			const found = _find_node(this.working_bt.root, this.selected_node_id);
			if (found) {
				found.node._label = el.target.value;
				this._save_working_bt();
			}
		});

		html.querySelector("[data-root-type]")?.addEventListener("change", (el) => {
			if (!this.working_bt) return;
			this._change_root_type(el.target.value, host);
		});

		html.querySelectorAll("[data-node-prop]").forEach((el) => {
			el.addEventListener("change", () => {
				const key = el.dataset.nodeProp;
				if (!this.working_bt || !this.selected_node_id) return;
				const found = _find_node(this.working_bt.root, this.selected_node_id);
				if (!found) return;

				const field_def = _get_node_fields(found.node).find((f) => f.key === key);
				let val = el.value;

				if (field_def?.type === "number") {
					val = val === "" ? null : Number(val);
				} else if (field_def?.type === "boolean") {
					val = el.checked;
				} else if (field_def?.type === "dropdown" && el.tagName === "SELECT") {
					if (key === "match") val = el.value === "true";
				} else if (key === "days") {
					val = val.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
				} else if (key === "lines") {
					val = val.split(";").map((s) => s.trim()).filter((s) => s.length);
				}

				found.node[key] = val;
				this._save_working_bt();
			});
		});

		html.querySelector("[data-action='add-node']")?.addEventListener("click", () => {
			this._add_node("child", html, host);
		});

		html.querySelector("[data-action='add-sibling']")?.addEventListener("click", () => {
			this._add_node("sibling", html, host);
		});

		html.querySelector("[data-action='delete-node']")?.addEventListener("click", () => {
			this._delete_node(host);
		});

		html.querySelector("[data-action='move-up']")?.addEventListener("click", () => {
			this._move_node(-1, host);
		});

		html.querySelector("[data-action='move-down']")?.addEventListener("click", () => {
			this._move_node(1, host);
		});

		this._populate_region_selects(html);
		this._populate_door_selects(html);
		this._populate_fragment_selects(html);
		this._wire_settings_panels(html);
		this._wire_variable_events(html, host);
	}

	_wire_settings_panels(html) {
		if (!this._settings_panel_open) this._settings_panel_open = { tree: false, variables: false };
		html.querySelectorAll("details[data-settings-panel]").forEach((el) => {
			const key = el.dataset.settingsPanel;
			if (this._settings_panel_open[key]) el.open = true;
			el.addEventListener("toggle", () => {
				this._settings_panel_open[key] = el.open;
			});
		});
	}

	_render_variable_row_html(var_def, idx) {
		const escape = foundry.utils.escapeHTML;
		const key_ro = var_def.key ? "readonly" : "";
		const type_opts = VARIABLE_TYPES.map((t) =>
			`<option value="${escape(t)}"${var_def.type === t ? " selected" : ""}>${escape(t)}</option>`
		).join("");
		return `<div class="bt-var-row" data-var-index="${idx}">
			<input type="text" data-var-field="key" value="${escape(var_def.key || "")}" placeholder="key" ${key_ro} />
			<input type="text" data-var-field="label" value="${escape(var_def.label || "")}" placeholder="Label" />
			<select data-var-field="type">${type_opts}</select>
			<input type="text" data-var-field="default" value="${escape(var_def.default || "")}" placeholder="(blank)" />
			<button type="button" data-var-delete="${idx}" class="editor-asset-delete"><i class="fa-solid fa-trash"></i></button>
		</div>`;
	}

	_refresh_variables_rows(html) {
		const table = html.querySelector(".bt-variables-table");
		if (!table || !this.working_bt) return;
		const header = table.querySelector(".bt-var-header");
		table.innerHTML = "";
		if (header) table.appendChild(header);
		else {
			const hdr = document.createElement("div");
			hdr.className = "bt-var-row bt-var-header";
			hdr.innerHTML = "<span>Key</span><span>Label</span><span>Type</span><span>Default</span><span></span>";
			table.appendChild(hdr);
		}
		const vars = this.working_bt.variables || [];
		for (let i = 0; i < vars.length; i++) {
			table.insertAdjacentHTML("beforeend", this._render_variable_row_html(vars[i], i));
		}
	}

	_wire_variable_events(html, host) {
		const add_btn = html.querySelector("[data-action='add-variable']");
		if (add_btn && !add_btn.dataset.wired) {
			add_btn.dataset.wired = "1";
			add_btn.addEventListener("click", async () => {
				if (!this.working_bt) return;
				if (!this.working_bt.variables) this.working_bt.variables = [];
				this.working_bt.variables.push({ key: "", label: "", type: "text", default: "" });
				this._settings_panel_open.variables = true;
				await this._save_working_bt();
				this._refresh_variables_rows(html);
				this._wire_variable_events(html, host);
				this._populate_region_selects(html);
				this._populate_door_selects(html);
			});
		}

		html.querySelectorAll("[data-var-field]").forEach((el) => {
			if (el.dataset.wired) return;
			el.dataset.wired = "1";
			el.addEventListener("change", async () => {
				if (!this.working_bt) return;
				const row = el.closest("[data-var-index]");
				const idx = parseInt(row.dataset.varIndex, 10);
				const field = el.dataset.varField;
				const var_def = this.working_bt.variables[idx];
				if (!var_def) return;

				if (field === "key") {
					var_def.key = el.value.trim().toLowerCase().replace(/\s+/g, "_");
					if (var_def.key) el.readOnly = true;
					this._populate_region_selects(html);
					this._populate_door_selects(html);
				} else if (field === "type") {
					var_def.type = el.value;
				} else {
					var_def[field] = el.value;
				}
				await this._save_working_bt();
			});
		});

		html.querySelectorAll("[data-var-delete]").forEach((el) => {
			if (el.dataset.wired) return;
			el.dataset.wired = "1";
			el.addEventListener("click", async () => {
				if (!this.working_bt) return;
				const idx = parseInt(el.dataset.varDelete, 10);
				this.working_bt.variables.splice(idx, 1);
				this._settings_panel_open.variables = true;
				await this._save_working_bt();
				this._refresh_variables_rows(html);
				this._wire_variable_events(html, host);
				this._populate_region_selects(html);
				this._populate_door_selects(html);
			});
		});
	}

	_populate_region_selects(html) {
		const escape = foundry.utils.escapeHTML;
		const variable_opts = [];
		for (const def of this.working_bt?.variables || []) {
			const key = def.key?.trim();
			if (!key) continue;
			const tag = `{{${key}}}`;
			const label = def.label ? `${tag} (${def.label})` : tag;
			variable_opts.push(`<option value="${escape(tag)}">${escape(label)}</option>`);
		}

		const region_opts = [];
		const scene = canvas.scene;
		if (scene?.regions) {
			const seen = new Set();
			for (const region of scene.regions) {
				const name = (region.name || "").trim();
				if (!name || seen.has(name)) continue;
				seen.add(name);
				region_opts.push(`<option value="${escape(name)}">${escape(name)}</option>`);
			}
		}

		let current_region_name = "";
		if (this.selected_node_id && this.working_bt) {
			const found = _find_node(this.working_bt.root, this.selected_node_id);
			if (found?.node?.region_name) current_region_name = found.node.region_name;
		}

		html.querySelectorAll("select[data-node-prop='region_name']").forEach((sel) => {
			let inner = '<option value=""></option>';
			if (variable_opts.length) {
				inner += `<optgroup label="${escape(game.i18n.localize("dc-npc-patrols.editor.var_options"))}">${variable_opts.join("")}</optgroup>`;
			}
			if (region_opts.length) {
				inner += `<optgroup label="${escape(game.i18n.localize("dc-npc-patrols.editor.scene_regions"))}">${region_opts.join("")}</optgroup>`;
			}
			sel.innerHTML = inner;
			sel.value = current_region_name;
		});
	}

	_populate_door_selects(html) {
		const escape = foundry.utils.escapeHTML;
		const foundry_var_opts = [];
		for (const def of this.working_bt?.variables || []) {
			if (def.type !== "foundry_id") continue;
			const key = def.key?.trim();
			if (!key) continue;
			const tag = `{{${key}}}`;
			const label = def.label ? `${tag} (${def.label})` : tag;
			foundry_var_opts.push(`<option value="${escape(tag)}">${escape(label)}</option>`);
		}

		const door_opts = get_door_options(canvas.scene).map(
			(d) => `<option value="${escape(d.value)}">${escape(d.label)}</option>`
		);

		let current_wall_id = "";
		if (this.selected_node_id && this.working_bt) {
			const found = _find_node(this.working_bt.root, this.selected_node_id);
			if (found?.node?.wall_id) current_wall_id = found.node.wall_id;
		}

		html.querySelectorAll("select[data-node-prop='wall_id']").forEach((sel) => {
			let inner = '<option value=""></option>';
			if (foundry_var_opts.length) {
				inner += `<optgroup label="${escape(game.i18n.localize("dc-npc-patrols.editor.var_options"))}">${foundry_var_opts.join("")}</optgroup>`;
			}
			if (door_opts.length) {
				inner += `<optgroup label="${escape(game.i18n.localize("dc-npc-patrols.editor.scene_doors"))}">${door_opts.join("")}</optgroup>`;
			}
			sel.innerHTML = inner;
			sel.value = current_wall_id;
		});
	}

	_populate_fragment_selects(html) {
		const escape = foundry.utils.escapeHTML;
		const fragment_opts = list_fragments().map(
			(f) => `<option value="${escape(f.id)}">${escape(f.name || f.id)}</option>`
		);

		let current_bt_id = "";
		if (this.selected_node_id && this.working_bt) {
			const found = _find_node(this.working_bt.root, this.selected_node_id);
			if (found?.node?.bt_id) current_bt_id = found.node.bt_id;
		}

		html.querySelectorAll("select[data-node-prop='bt_id']").forEach((sel) => {
			let inner = '<option value=""></option>';
			if (fragment_opts.length) inner += fragment_opts.join("");
			sel.innerHTML = inner;
			sel.value = current_bt_id;
		});
	}

	_select_bt(id, host) {
		this.selected_bt_id = id;
		this.selected_node_id = null;
		this.working_bt = null;
		host.render();
	}

	select_bt(id, host) {
		this._select_bt(id, host);
	}

	async _add_bt(host, kind = BT_KIND_TREE) {
		const default_name = kind === BT_KIND_FRAGMENT ? "New Fragment" : "New Tree";
		const bt = make_bt(default_name, kind);
		_assign_ids(bt.root);
		const saved = await save_bt(bt);
		this.selected_bt_id = saved.id;
		this.selected_node_id = saved.root._id;
		this.working_bt = null;
		host.render();
	}

	_add_node(mode, html, host) {
		if (!this.working_bt || !this.selected_node_id) {
			if (!this.working_bt) return;
			const select = html.querySelector("[data-node-type-select]");
			const type = select?.value || "action_idle";
			const new_node = { _id: _gen_node_id(), type, _label: "" };
			if (NODE_REGISTRY[type]?.category === "composite") {
				new_node.children = [];
			} else if (NODE_REGISTRY[type]?.category === "decorator") {
				new_node.child = null;
			}
			_init_node_defaults(new_node);
			this.working_bt.root = new_node;
			_assign_ids(this.working_bt.root);
			this.selected_node_id = new_node._id;
			this._save_working_bt();
			host.render();
			return;
		}

		const select = html.querySelector("[data-node-type-select]");
		const type = select?.value || "action_idle";
		const def = NODE_REGISTRY[type];
		const new_node = { _id: _gen_node_id(), type, _label: "" };
		if (def?.category === "composite") new_node.children = [];
		else if (def?.category === "decorator") new_node.child = null;
		_init_node_defaults(new_node);

		const found = _find_node(this.working_bt.root, this.selected_node_id);
		if (!found) return;

		if (mode === "child") {
			_insert_node_as_child(found, new_node);
		} else if (found.parent?.children) {
			found.parent.children.splice(found.key + 1, 0, new_node);
		}

		this.selected_node_id = new_node._id;
		this._save_working_bt();
		host.render();
	}

	_delete_node(host) {
		if (!this.working_bt || !this.selected_node_id) return;
		if (this.working_bt.root._id === this.selected_node_id) {
			ui.notifications.warn("Cannot delete the root node. Change its type instead, or wrap logic in a child node.");
			return;
		}
		const found = _find_node(this.working_bt.root, this.selected_node_id);
		if (!found || !found.parent) return;

		if (found.parent.children) {
			found.parent.children.splice(found.key, 1);
		} else if (found.key === "child") {
			found.parent.child = null;
		}

		this.selected_node_id = this.working_bt.root._id;
		this._save_working_bt();
		host.render();
	}

	_move_node(direction, host) {
		if (!this.working_bt || !this.selected_node_id) return;
		const found = _find_node(this.working_bt.root, this.selected_node_id);
		if (!found || !found.parent?.children) return;

		const siblings = found.parent.children;
		const idx = found.key;
		const new_idx = idx + direction;
		if (new_idx < 0 || new_idx >= siblings.length) return;

		[siblings[idx], siblings[new_idx]] = [siblings[new_idx], siblings[idx]];
		this._save_working_bt();
		host.render();
	}

	_change_root_type(type, host) {
		if (!this.working_bt?.root) return;
		const def = NODE_REGISTRY[type];
		if (def?.category !== "composite") {
			ui.notifications.warn("The root node must be a composite (Selector, Sequence, or Parallel).");
			return;
		}

		const root = this.working_bt.root;
		if (root.type === type) return;

		root.type = type;
		root.children ??= [];
		delete root.child;

		if (type === "parallel" && root.required == null) {
			root.required = root.children.length || 1;
		} else if (type !== "parallel") {
			delete root.required;
		}

		this._save_working_bt();
		host.render();
	}

	async _save_working_bt() {
		if (!this.working_bt) return;
		this.working_bt.kind = normalize_bt_kind(this.working_bt.kind);
		repair_misplaced_child_nodes(this.working_bt.root);
		await save_bt(foundry.utils.deepClone(this.working_bt));
	}

	async _save_selection_as_fragment(host) {
		if (!this.working_bt || !this.selected_node_id) return;

		const found = _find_node(this.working_bt.root, this.selected_node_id);
		if (!found?.node) return;

		const default_name = _node_label(found.node) || this.working_bt.name || "Fragment";
		const name = await _prompt_fragment_name(default_name);
		if (!name) return;

		const extracted = extract_selection(this.working_bt.root, this.selected_node_id);
		if (!extracted) return;

		_assign_ids(extracted);
		const variables = infer_variables_for_node(extracted, this.working_bt.variables || []);
		const fragment = make_bt(name, BT_KIND_FRAGMENT);
		fragment.root = extracted;
		fragment.variables = variables;

		const err = validate_bt_tree(fragment);
		if (err) {
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.bt.import_invalid"));
			console.warn("dc-npc-patrols: fragment validation failed:", err);
			return;
		}

		const saved = await save_bt(fragment);
		this.selected_bt_id = saved.id;
		this.selected_node_id = saved.root._id;
		this.working_bt = null;
		ui.notifications.info(
			game.i18n.format("dc-npc-patrols.bt.fragment_saved", { name: saved.name })
		);
		host.render();
	}

	async _insert_fragment(fragment_id, host) {
		if (!this.working_bt || !this.selected_node_id || !fragment_id) return;

		const fragment = get_bt(fragment_id);
		if (!fragment?.root) return;

		const clone = clone_subtree(fragment.root, fragment.id);
		if (!clone) return;

		const { merged, conflicts } = merge_variables(
			this.working_bt.variables || [],
			fragment.variables || []
		);
		if (conflicts.length) {
			ui.notifications.warn(
				game.i18n.format("dc-npc-patrols.bt.fragment_var_conflict", {
					keys: conflicts.join(", "),
				})
			);
		}
		this.working_bt.variables = merged;

		const found = _find_node(this.working_bt.root, this.selected_node_id);
		if (!found) return;

		_insert_node_as_child(found, clone);
		this.selected_node_id = clone._id;
		await this._save_working_bt();
		ui.notifications.info(
			game.i18n.format("dc-npc-patrols.bt.fragment_inserted", { name: fragment.name || fragment.id })
		);
		host.render();
	}

	async _link_fragment(fragment_id, host) {
		if (!this.working_bt || !this.selected_node_id || !fragment_id) return;

		const fragment = get_bt(fragment_id);
		if (!fragment?.root) return;

		if (normalize_bt_kind(fragment.kind) !== BT_KIND_FRAGMENT) return;

		if (this.working_bt.id && would_create_cycle(this.working_bt.id, fragment_id)) {
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.bt.fragment_cycle"));
			return;
		}

		const subtree_node = make_subtree_node(fragment_id);
		const found = _find_node(this.working_bt.root, this.selected_node_id);
		if (!found) return;

		_insert_node_as_child(found, subtree_node);
		this.selected_node_id = subtree_node._id;
		await this._save_working_bt();
		ui.notifications.info(
			game.i18n.format("dc-npc-patrols.bt.fragment_linked", { name: fragment.name || fragment.id })
		);
		host.render();
	}

	_export_bt() {
		if (!this.selected_bt_id) return;
		const tree = get_bt(this.selected_bt_id);
		if (!tree) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.editor.select_bt"));
			return;
		}
		const json = serialize_bt_export(tree);
		saveDataToFile(json, "application/json", export_filename(tree));
		ui.notifications.info(
			game.i18n.format("dc-npc-patrols.bt.export_success", { name: tree.name || tree.id })
		);
	}

	async _import_bt(file, host) {
		try {
			const text = await readTextFromFile(file);
			const tree = parse_bt_import(text);
			const err = validate_bt_tree(tree);
			if (err) {
				ui.notifications.error(game.i18n.localize("dc-npc-patrols.bt.import_invalid"));
				console.warn("dc-npc-patrols: BT import validation failed:", err);
				return;
			}
			const prepared = prepare_imported_tree(tree, get_bts());
			const saved = await save_bt(prepared);
			this.selected_bt_id = saved.id;
			this.selected_node_id = saved.root?._id ?? null;
			this.working_bt = null;
			ui.notifications.info(
				game.i18n.format("dc-npc-patrols.bt.import_success", { name: saved.name })
			);
			host.render();
		} catch (e) {
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.bt.import_invalid"));
			console.warn("dc-npc-patrols: BT import failed:", e);
		}
	}
}

export async function prepare_bt_context(state) {
	const ctrl = state instanceof BTEditorController ? state : Object.assign(new BTEditorController(), state);
	return ctrl.prepare_context();
}

export function wire_bt_events(state, html, host) {
	const ctrl = state instanceof BTEditorController ? state : Object.assign(new BTEditorController(), state);
	ctrl.wire_events(html, host);
}

export class BTEditor extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dc-bt-editor",
		classes: ["dc-bt-editor-app"],
		tag: "div",
		window: {
			title: "dc-npc-patrols.bt.editor_title",
			icon: "fa-solid fa-diagram-project",
			resizable: true,
		},
		position: {
			width: 900,
			height: 700,
		},
	};

	static PARTS = {
		main: { template: "modules/dc-npc-patrols/templates/bt-editor.hbs" },
	};

	_ctrl = new BTEditorController();

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
