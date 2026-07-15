/**
 * bt_editor.js — GM-facing behaviour tree editor (ApplicationV2).
 *
 * Three-panel layout:
 *   - Left sidebar: list of BTs (select, add, delete)
 *   - Main panel: indented tree visualisation with node selection
 *   - Bottom panel: data-driven node properties
 *
 * Node properties are rendered from NODE_REGISTRY[type].editor.fields —
 * fully data-driven, no per-type hardcoded UI.
 */

import { get_bts, save_bt, delete_bt, make_bt } from "./bt_store.js";
import { NODE_REGISTRY } from "./bt_nodes.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "dc-npc-patrols";

let _node_id_counter = 0;
function _gen_node_id() {
	return `n${++_node_id_counter}_${Date.now().toString(36).slice(-4)}`;
}

/** Variable types available in the BT editor dropdown. */
const VARIABLE_TYPES = ["text", "number", "boolean", "waypoint_select"];

/** Assign _id to all nodes in a tree (recursive). */
function _assign_ids(node) {
	if (!node) return;
	if (!node._id) node._id = _gen_node_id();
	if (node._label === undefined) node._label = "";
	if (node.children) for (const c of node.children) _assign_ids(c);
	if (node.child) _assign_ids(node.child);
}

/** Find a node by _id in the tree (recursive). Returns the node and its parent array/key. */
function _find_node(root, id, parent = null, key = null) {
	if (root._id === id) return { node: root, parent, key };
	if (root.children) {
		for (let i = 0; i < root.children.length; i++) {
			const result = _find_node(root.children[i], id, root, i);
			if (result) return result;
		}
	}
	if (root.child) {
		const result = _find_node(root.child, id, root, 'child');
		if (result) return result;
	}
	return null;
}

/** Flatten the tree into a list for rendering (with level + parent info). */
function _flatten(root, level = 0, result = []) {
	if (!root) return result;
	const def = NODE_REGISTRY[root.type];
	result.push({
		_id: root._id,
		type: root.type,
		label: root._label || def?.label || root.type,
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

/** Get node label for properties panel title. */
function _node_label(node) {
	const def = NODE_REGISTRY[node.type];
	if (node._label) return node._label;
	return def?.label || node.type;
}

/** Get a flat list of all nodes for the template (with level for indentation). */
function _prepare_tree_view(root, selected_node_id) {
	const flat = _flatten(root);
	return flat.map(n => ({
		...n,
		selected: n._id === selected_node_id,
		indent: n.level * 20,
	}));
}

/** Get the field definitions for a node type from the registry. */
function _get_node_fields(node) {
	const def = NODE_REGISTRY[node.type];
	return def?.editor?.fields || [];
}

/** Get field value from node, applying default if missing. */
function _get_field_value(node, field) {
	const val = node[field.key];
	if (val === undefined || val === null) return field.default ?? "";
	// Convert arrays to comma-separated strings for text editing
	if (Array.isArray(val)) return val.join(",");
	return val;
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

	// Internal state
	_selected_bt_id = null;
	_selected_node_id = null;
	_working_bt = null;

	async _prepareContext(_options) {
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

		if (this._selected_bt_id && bts[this._selected_bt_id]) {
			if (!this._working_bt || this._working_bt.id !== this._selected_bt_id) {
				this._working_bt = foundry.utils.deepClone(bts[this._selected_bt_id]);
				_assign_ids(this._working_bt.root);
			}
			selected_bt = this._working_bt;

			tree_nodes = _prepare_tree_view(selected_bt.root, this._selected_node_id);

			if (this._selected_node_id) {
				const found = _find_node(selected_bt.root, this._selected_node_id);
				if (found) {
					selected_node = found.node;
					node_label = _node_label(selected_node);
					node_fields = _get_node_fields(selected_node);
					node_field_values = {};
					for (const field of node_fields) {
						node_field_values[field.key] = _get_field_value(selected_node, field);
					}
				}
			}
		}

		// Get all node types for the add-node dropdown, grouped by category
		const node_types = _get_node_type_options();

		// Build set of declared variable keys for reference checking
		const var_keys = new Set((selected_bt?.variables || []).map(v => v.key).filter(Boolean));

		// Annotate node fields with variable reference info
		if (selected_node) {
			for (const field of node_fields) {
				const val = node_field_values[field.key];
				if (typeof val === 'string' && val.includes('{{')) {
					const refs = [...val.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
					field._var_refs = refs.map(name => ({
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
			selected_bt_id: this._selected_bt_id,
			selected_bt,
			tree_nodes,
			selected_node_id: this._selected_node_id,
			selected_node,
			node_label,
			node_fields,
			node_field_values,
			node_types,
			var_types: VARIABLE_TYPES,
		};
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;

		// BT selection
		html.querySelectorAll("[data-bt-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-bt-delete]")) return;
				this._select_bt(ev.currentTarget.dataset.btSelect);
			});
		});

		// BT delete
		html.querySelectorAll("[data-bt-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.btDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.bt.delete_confirm"),
				});
				if (!confirmed) return;
				await delete_bt(id);
				if (this._selected_bt_id === id) {
					this._selected_bt_id = null;
					this._selected_node_id = null;
					this._working_bt = null;
				}
				this.render({ force: true });
			});
		});

		// Add BT
		html.querySelector("[data-action='add-bt']")?.addEventListener("click", () => {
			this._add_bt();
		});

		// BT meta fields (name, description)
		html.querySelectorAll("[data-bt-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const field = el.dataset.btField;
				if (!this._working_bt) return;
				this._working_bt[field] = el.value;
				this._save_working_bt();
			});
		});

		// Node selection
		html.querySelectorAll("[data-node-id]").forEach((el) => {
			el.addEventListener("click", () => {
				this._selected_node_id = el.dataset.nodeId;
				this.render({ force: true });
			});
		});

		// Node label editing
		html.querySelector("[data-node-label]")?.addEventListener("change", (el) => {
			if (!this._working_bt || !this._selected_node_id) return;
			const found = _find_node(this._working_bt.root, this._selected_node_id);
			if (found) {
				found.node._label = el.target.value;
				this._save_working_bt();
			}
		});

		// Node property fields
		html.querySelectorAll("[data-node-prop]").forEach((el) => {
			el.addEventListener("change", () => {
				const key = el.dataset.nodeProp;
				if (!this._working_bt || !this._selected_node_id) return;
				const found = _find_node(this._working_bt.root, this._selected_node_id);
				if (!found) return;

				const field_def = _get_node_fields(found.node).find(f => f.key === key);
				let val = el.value;

				// Parse value based on field type
				if (field_def?.type === "number") {
					val = val === "" ? null : Number(val);
				} else if (field_def?.type === "dropdown" && el.tagName === "SELECT") {
					// Handle match field which can be boolean
					if (key === "match") {
						val = el.value === "true";
					}
				} else if (key === "days") {
					// Parse comma-separated into number array
					val = val.split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
				} else if (key === "lines") {
					// Parse semicolon-separated into array
					val = val.split(";").map(s => s.trim()).filter(s => s.length);
				}

				found.node[key] = val;
				this._save_working_bt();
			});
		});

		// Add node as child
		html.querySelector("[data-action='add-node']")?.addEventListener("click", () => {
			this._add_node("child");
		});

		// Add node as sibling
		html.querySelector("[data-action='add-sibling']")?.addEventListener("click", () => {
			this._add_node("sibling");
		});

		// Delete node
		html.querySelector("[data-action='delete-node']")?.addEventListener("click", () => {
			this._delete_node();
		});

		// Move up
		html.querySelector("[data-action='move-up']")?.addEventListener("click", () => {
			this._move_node(-1);
		});

		// Move down
		html.querySelector("[data-action='move-down']")?.addEventListener("click", () => {
			this._move_node(1);
		});

		// Populate region_select dropdowns dynamically
		this._populate_region_selects(html);

		// ── Variable management ──

		// Add variable
		html.querySelector("[data-action='add-variable']")?.addEventListener("click", () => {
			if (!this._working_bt) return;
			if (!this._working_bt.variables) this._working_bt.variables = [];
			this._working_bt.variables.push({ key: "", label: "", type: "text", default: "" });
			this._save_working_bt();
			this.render({ force: true });
		});

		// Edit variable fields (key, label, type, default)
		html.querySelectorAll("[data-var-field]").forEach((el) => {
			el.addEventListener("change", () => {
				if (!this._working_bt) return;
				const row = el.closest("[data-var-index]");
				const idx = parseInt(row.dataset.varIndex, 10);
				const field = el.dataset.varField;
				const var_def = this._working_bt.variables[idx];
				if (!var_def) return;

				if (field === "key") {
					// Sanitize key: lowercase, replace spaces with underscores
					const new_key = el.value.trim().toLowerCase().replace(/\s+/g, "_");
					var_def.key = new_key;
				} else if (field === "type") {
					var_def.type = el.value;
				} else {
					var_def[field] = el.value;
				}
				this._save_working_bt();
				this.render({ force: true });
			});
		});

		// Delete variable
		html.querySelectorAll("[data-var-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				if (!this._working_bt) return;
				const idx = parseInt(el.dataset.varDelete, 10);
				this._working_bt.variables.splice(idx, 1);
				this._save_working_bt();
				this.render({ force: true });
			});
		});
	}

	// ── Region select population ────────────────────────────────────

	_populate_region_selects(html) {
		const scene = canvas.scene;
		if (!scene) return;
		const regions = scene.regions.filter(r => r.name).map(r => ({
			id: r.name,
			name: r.name,
		}));

		html.querySelectorAll("select[data-node-prop='region_name']").forEach((sel) => {
			// Preserve current value
			const current = sel.value;
			sel.innerHTML = '<option value=""></option>' +
				regions.map(r => `<option value="${r.id}">${r.name}</option>`).join("");
			sel.value = current;
		});
	}

	// ── BT operations ───────────────────────────────────────────────

	_select_bt(id) {
		this._selected_bt_id = id;
		this._selected_node_id = null;
		this._working_bt = null;
		this.render({ force: true });
	}

	async _add_bt() {
		const bt = make_bt("New Tree");
		_assign_ids(bt.root);
		const saved = await save_bt(bt);
		this._selected_bt_id = saved.id;
		this._selected_node_id = saved.root._id;
		this._working_bt = null;
		this.render({ force: true });
	}

	_add_node(mode) {
		if (!this._working_bt || !this._selected_node_id) {
			// No selection — add as root child
			if (!this._working_bt) return;
			const select = this.element.querySelector("[data-node-type-select]");
			const type = select?.value || "action_idle";
			const new_node = { _id: _gen_node_id(), type, _label: "" };
			if (NODE_REGISTRY[type]?.category === "composite") {
				new_node.children = [];
			} else if (NODE_REGISTRY[type]?.category === "decorator") {
				new_node.child = null;
			}
			this._working_bt.root = new_node;
			_assign_ids(this._working_bt.root);
			this._selected_node_id = new_node._id;
			this._save_working_bt();
			this.render({ force: true });
			return;
		}

		const select = this.element.querySelector("[data-node-type-select]");
		const type = select?.value || "action_idle";
		const def = NODE_REGISTRY[type];
		const new_node = { _id: _gen_node_id(), type, _label: "" };
		if (def?.category === "composite") new_node.children = [];
		else if (def?.category === "decorator") new_node.child = null;

		const found = _find_node(this._working_bt.root, this._selected_node_id);
		if (!found) return;

		if (mode === "child") {
			// Add as child of selected composite/decorator
			if (found.node.children) {
				found.node.children.push(new_node);
			} else if (found.node.child === null || found.node.child === undefined) {
				found.node.child = new_node;
			} else if ('child' in found.node) {
				found.node.child = new_node;
			} else {
				// Can't add child to a leaf node — add as sibling instead
				if (found.parent?.children) {
					found.parent.children.splice(found.key + 1, 0, new_node);
				}
			}
		} else {
			// Add as sibling
			if (found.parent?.children) {
				found.parent.children.splice(found.key + 1, 0, new_node);
			}
		}

		this._selected_node_id = new_node._id;
		this._save_working_bt();
		this.render({ force: true });
	}

	_delete_node() {
		if (!this._working_bt || !this._selected_node_id) return;
		if (this._working_bt.root._id === this._selected_node_id) {
			ui.notifications.warn("Cannot delete the root node.");
			return;
		}
		const found = _find_node(this._working_bt.root, this._selected_node_id);
		if (!found || !found.parent) return;

		if (found.parent.children) {
			found.parent.children.splice(found.key, 1);
		} else if (found.key === 'child') {
			found.parent.child = null;
		}

		this._selected_node_id = this._working_bt.root._id;
		this._save_working_bt();
		this.render({ force: true });
	}

	_move_node(direction) {
		if (!this._working_bt || !this._selected_node_id) return;
		const found = _find_node(this._working_bt.root, this._selected_node_id);
		if (!found || !found.parent?.children) return;

		const siblings = found.parent.children;
		const idx = found.key;
		const new_idx = idx + direction;
		if (new_idx < 0 || new_idx >= siblings.length) return;

		[siblings[idx], siblings[new_idx]] = [siblings[new_idx], siblings[idx]];
		this._save_working_bt();
		this.render({ force: true });
	}

	async _save_working_bt() {
		if (!this._working_bt) return;
		await save_bt(foundry.utils.deepClone(this._working_bt));
	}
}

// ── Helpers ───────────────────────────────────────────────────────

function _get_node_type_options() {
	const categories = { composite: [], decorator: [], condition: [], action: [] };
	for (const [type, def] of Object.entries(NODE_REGISTRY)) {
		const cat = def.category || "action";
		if (!categories[cat]) categories[cat] = [];
		categories[cat].push({ type, label: def.label || type });
	}
	return categories;
}