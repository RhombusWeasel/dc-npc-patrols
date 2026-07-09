/**
 * ambient_editor.js — GM-facing ambient line set editor (ApplicationV2).
 *
 * Left sidebar: list of ambient sets.
 * Right panel: set name + editable line list with add/remove.
 *
 * Ambient sets are shared collections of flavour lines that can be
 * attached to multiple NPCs. When a player enters an NPC's ambient
 * proximity region, a random line is whispered to them (with cooldown).
 */

import {
	get_ambient_sets, save_ambient_set, delete_ambient_set, make_ambient_set,
} from "./dialog_tree_store.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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

	_selected_set_id = null;
	_working_set = null;

	async _prepareContext(_options) {
		const sets = get_ambient_sets();
		const set_list = Object.values(sets).map((s) => ({
			id: s.id,
			name: s.name || "(unnamed)",
		}));

		let selected_set = null;
		if (this._selected_set_id && sets[this._selected_set_id]) {
			if (!this._working_set || this._working_set.id !== this._selected_set_id) {
				this._working_set = foundry.utils.deepClone(sets[this._selected_set_id]);
			}
			selected_set = this._working_set;
		}

		return {
			sets: set_list,
			selected_set_id: this._selected_set_id,
			selected_set,
		};
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;

		// Set selection
		html.querySelectorAll("[data-set-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-set-delete]")) return;
				this._selected_set_id = ev.currentTarget.dataset.setSelect;
				this._working_set = null;
				this.render({ force: true });
			});
		});

		// Set delete
		html.querySelectorAll("[data-set-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.setDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.ambient.delete_set_confirm"),
				});
				if (!confirmed) return;
				await delete_ambient_set(id);
				if (this._selected_set_id === id) {
					this._selected_set_id = null;
					this._working_set = null;
				}
				this.render({ force: true });
			});
		});

		// Add set
		html.querySelector("[data-action='add-set']")?.addEventListener("click", async () => {
			const set = make_ambient_set("New Ambient Set");
			const saved = await save_ambient_set(set);
			this._selected_set_id = saved.id;
			this._working_set = null;
			this.render({ force: true });
		});

		// Set name field
		html.querySelector("[data-set-field='name']")?.addEventListener("change", (el) => {
			if (!this._working_set) return;
			this._working_set.name = el.target.value;
			this._save_working_set();
		});

		// Line fields
		html.querySelectorAll("[data-line-field]").forEach((el) => {
			el.addEventListener("change", () => {
				const idx = parseInt(el.dataset.lineField, 10);
				if (!this._working_set) return;
				this._working_set.lines[idx] = el.value;
				this._save_working_set();
			});
		});

		// Line delete
		html.querySelectorAll("[data-line-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				const idx = parseInt(el.dataset.lineDelete, 10);
				if (!this._working_set) return;
				this._working_set.lines.splice(idx, 1);
				this._save_working_set();
				this.render({ force: true });
			});
		});

		// Add line
		html.querySelector("[data-action='add-line']")?.addEventListener("click", () => {
			if (!this._working_set) return;
			this._working_set.lines.push("");
			this._save_working_set();
			this.render({ force: true });
		});
	}

	async _save_working_set() {
		if (!this._working_set) return;
		await save_ambient_set(foundry.utils.deepClone(this._working_set));
	}
}