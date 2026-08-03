/**
 * ambient_editor.js — GM-facing ambient line set editor (ApplicationV2).
 */

import {
	get_ambient_sets, save_ambient_set, delete_ambient_set, make_ambient_set,
} from "./dialog_tree_store.js";
import {
	serialize_ambient_export, parse_ambient_import,
	prepare_imported_ambient, ambient_export_filename,
} from "./dialog_io.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export function create_ambient_editor_state() {
	return {
		selected_set_id: null,
		working_set: null,
	};
}

export class AmbientEditorController {
	constructor() {
		Object.assign(this, create_ambient_editor_state());
	}

	async prepare_context() {
		const sets = get_ambient_sets();
		const set_list = Object.values(sets).map((s) => ({
			id: s.id,
			name: s.name || "(unnamed)",
		}));

		let selected_set = null;
		if (this.selected_set_id && sets[this.selected_set_id]) {
			if (!this.working_set || this.working_set.id !== this.selected_set_id) {
				this.working_set = foundry.utils.deepClone(sets[this.selected_set_id]);
			}
			selected_set = this.working_set;
		}

		return {
			sets: set_list,
			selected_set_id: this.selected_set_id,
			selected_set,
		};
	}

	wire_events(html, host) {
		html.querySelectorAll("[data-set-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-set-delete]")) return;
				this.selected_set_id = ev.currentTarget.dataset.setSelect;
				this.working_set = null;
				host.render();
			});
		});

		html.querySelectorAll("[data-set-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.setDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.ambient.delete_set_confirm"),
				});
				if (!confirmed) return;
				await delete_ambient_set(id);
				if (this.selected_set_id === id) {
					this.selected_set_id = null;
					this.working_set = null;
				}
				host.render();
			});
		});

		html.querySelector("[data-action='add-set']")?.addEventListener("click", async () => {
			const set = make_ambient_set("New Ambient Set");
			const saved = await save_ambient_set(set);
			this.selected_set_id = saved.id;
			this.working_set = null;
			host.render();
		});

		html.querySelector("[data-action='export-set']")?.addEventListener("click", () => {
			this._export_set();
		});

		const ambient_import_input = html.querySelector("[data-ambient-import-input]");
		html.querySelector("[data-action='import-set']")?.addEventListener("click", () => {
			ambient_import_input?.click();
		});
		if (ambient_import_input && !ambient_import_input.dataset.wired) {
			ambient_import_input.dataset.wired = "1";
			ambient_import_input.addEventListener("change", async () => {
				const file = ambient_import_input.files?.[0];
				ambient_import_input.value = "";
				if (file) await this._import_set(file, host);
			});
		}

		html.querySelector("[data-set-field='name']")?.addEventListener("change", (el) => {
			if (!this.working_set) return;
			this.working_set.name = el.target.value;
			this._save_working_set();
		});

		html.querySelectorAll("[data-line-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const idx = parseInt(el.dataset.lineField, 10);
				if (!this.working_set) return;
				this.working_set.lines[idx] = el.value;
				this._save_working_set();
			});
		});

		html.querySelectorAll("[data-line-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const idx = parseInt(el.dataset.lineDelete, 10);
				if (!this.working_set) return;
				this.working_set.lines.splice(idx, 1);
				this._save_working_set();
				host.render();
			});
		});

		html.querySelector("[data-action='add-line']")?.addEventListener("click", () => {
			if (!this.working_set) return;
			this.working_set.lines.push("");
			this._save_working_set();
			host.render();
		});
	}

	async _save_working_set() {
		if (!this.working_set) return;
		await save_ambient_set(foundry.utils.deepClone(this.working_set));
	}

	_export_set() {
		if (!this.selected_set_id) return;
		const sets = get_ambient_sets();
		const set = sets[this.selected_set_id];
		if (!set) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.ambient.select_set"));
			return;
		}
		const json = serialize_ambient_export(set);
		saveDataToFile(json, "application/json", ambient_export_filename(set));
		ui.notifications.info(
			game.i18n.format("dc-npc-patrols.ambient.export_success", { name: set.name || set.id })
		);
	}

	async _import_set(file, host) {
		try {
			const text = await readTextFromFile(file);
			const set = parse_ambient_import(text);
			const prepared = prepare_imported_ambient(set, get_ambient_sets());
			const saved = await save_ambient_set(prepared);
			this.selected_set_id = saved.id;
			this.working_set = null;
			ui.notifications.info(
				game.i18n.format("dc-npc-patrols.ambient.import_success", { name: saved.name })
			);
			host.render();
		} catch (e) {
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.ambient.import_invalid"));
			console.warn("dc-npc-patrols: Ambient set import failed:", e);
		}
	}
}

export async function prepare_ambient_context(state) {
	const ctrl = state instanceof AmbientEditorController ? state : Object.assign(new AmbientEditorController(), state);
	return ctrl.prepare_context();
}

export function wire_ambient_events(state, html, host) {
	const ctrl = state instanceof AmbientEditorController ? state : Object.assign(new AmbientEditorController(), state);
	ctrl.wire_events(html, host);
}

export class AmbientEditor extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dc-ambient-editor",
		classes: ["dc-ambient-editor-app"],
		tag: "div",
		window: {
			title: "dc-npc-patrols.ambient.editor_title",
			icon: "fa-solid fa-comment-dots",
			resizable: true,
		},
		position: {
			width: 700,
			height: 500,
		},
	};

	static PARTS = {
		main: { template: "modules/dc-npc-patrols/templates/ambient-editor.hbs" },
	};

	_ctrl = new AmbientEditorController();

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
