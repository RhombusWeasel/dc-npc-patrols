/**
 * bt_editor.js — GM-facing behaviour tree editor (ApplicationV2).
 */

import { get_bts, save_bt, delete_bt, make_bt } from "./bt_store.js";
import { NODE_REGISTRY } from "./bt_nodes.js";
import { get_equip_slot_options } from "./gear_actions.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let _node_id_counter = 0;
function _gen_node_id() {
	return `n${++_node_id_counter}_${Date.now().toString(36).slice(-4)}`;
}

const VARIABLE_TYPES = ["text", "number", "boolean", "waypoint_select"];

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

function _flatten(root, level = 0, result = []) {
	if (!root) return result;
	const def = NODE_REGISTRY[root.type];
	result.push({
		_id: root._id,
		type: root.type,
		label: root._label || def?.label || root.type,
		summary: _get_node_summary(root),
		category: def?.category || "unknown",
		icon: def?.icon || "fa-solid fa-circle",
		level,
	});
	if (root.children) {
		for (const c of root.children) _flatten(c, level + 1, result);
	}
	if (root.child) _flatten(root.child, level + 1, result);
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

export function create_bt_editor_state() {
	return {
		selected_bt_id: null,
		selected_node_id: null,
		working_bt: null,
	};
}

export class BTEditorController {
	constructor() {
		Object.assign(this, create_bt_editor_state());
	}

	async prepare_context() {
		const bts = get_bts();
		const bt_list = Object.values(bts).map((t) => ({
			id: t.id,
			name: t.name || "(unnamed)",
		}));

		let selected_bt = null;
		let tree_nodes = [];
		let selected_node = null;
		let node_label = "";
		let node_fields = [];
		let node_field_values = {};
		let node_breadcrumb = [];
		let selected_node_category = "";
		let selected_node_icon = "";

		if (this.selected_bt_id && bts[this.selected_bt_id]) {
			if (!this.working_bt || this.working_bt.id !== this.selected_bt_id) {
				this.working_bt = foundry.utils.deepClone(bts[this.selected_bt_id]);
				_assign_ids(this.working_bt.root);
			}
			selected_bt = this.working_bt;

			tree_nodes = _prepare_tree_view(selected_bt.root, this.selected_node_id);

			if (this.selected_node_id) {
				const found = _find_node(selected_bt.root, this.selected_node_id);
				if (found) {
					selected_node = found.node;
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
		const var_keys = new Set((selected_bt?.variables || []).map((v) => v.key).filter(Boolean));

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
			selected_bt_id: this.selected_bt_id,
			selected_bt,
			tree_nodes,
			selected_node_id: this.selected_node_id,
			selected_node,
			node_label,
			node_fields,
			node_field_values,
			node_breadcrumb,
			selected_node_category,
			selected_node_icon,
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

		html.querySelectorAll("[data-bt-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const field = el.dataset.btField;
				if (!this.working_bt) return;
				this.working_bt[field] = el.value;
				this._save_working_bt();
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

		html.querySelector("[data-action='add-variable']")?.addEventListener("click", () => {
			if (!this.working_bt) return;
			if (!this.working_bt.variables) this.working_bt.variables = [];
			this.working_bt.variables.push({ key: "", label: "", type: "text", default: "" });
			this._save_working_bt();
			host.render();
		});

		html.querySelectorAll("[data-var-field]").forEach((el) => {
			el.addEventListener("change", () => {
				if (!this.working_bt) return;
				const row = el.closest("[data-var-index]");
				const idx = parseInt(row.dataset.varIndex, 10);
				const field = el.dataset.varField;
				const var_def = this.working_bt.variables[idx];
				if (!var_def) return;

				if (field === "key") {
					var_def.key = el.value.trim().toLowerCase().replace(/\s+/g, "_");
				} else if (field === "type") {
					var_def.type = el.value;
				} else {
					var_def[field] = el.value;
				}
				this._save_working_bt();
				host.render();
			});
		});

		html.querySelectorAll("[data-var-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				if (!this.working_bt) return;
				const idx = parseInt(el.dataset.varDelete, 10);
				this.working_bt.variables.splice(idx, 1);
				this._save_working_bt();
				host.render();
			});
		});
	}

	_populate_region_selects(html) {
		const scene = canvas.scene;
		if (!scene) return;
		const regions = scene.regions.filter((r) => r.name).map((r) => ({
			id: r.name,
			name: r.name,
		}));

		let current_region_name = "";
		if (this.selected_node_id && this.working_bt) {
			const found = _find_node(this.working_bt.root, this.selected_node_id);
			if (found?.node?.region_name) current_region_name = found.node.region_name;
		}

		html.querySelectorAll("select[data-node-prop='region_name']").forEach((sel) => {
			sel.innerHTML = '<option value=""></option>' +
				regions.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
			sel.value = current_region_name;
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

	async _add_bt(host) {
		const bt = make_bt("New Tree");
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
			if (found.node.children) {
				found.node.children.push(new_node);
			} else if (found.node.child === null || found.node.child === undefined) {
				found.node.child = new_node;
			} else if ("child" in found.node) {
				found.node.child = new_node;
			} else if (found.parent?.children) {
				found.parent.children.splice(found.key + 1, 0, new_node);
			}
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
			ui.notifications.warn("Cannot delete the root node.");
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

	async _save_working_bt() {
		if (!this.working_bt) return;
		await save_bt(foundry.utils.deepClone(this.working_bt));
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
