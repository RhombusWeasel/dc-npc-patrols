/**
 * quest_editor.js — GM-facing quest editor controller for the Patrol Hub.
 *
 * Two sections sharing one view:
 *   1. World quest DEFINITIONS (authored here, stored in module "quest_defs").
 *   2. Per-posse quest STATE (instances from the posse store, edited through
 *      the quest socket write path so players' tabs stay in sync).
 *
 * Follows the AmbientEditorController shape (prepare_context / wire_events).
 */

import {
	get_quest_defs, get_quest_def, save_quest_def, delete_quest_def, make_quest_def,
} from "./quest_store.js";
import { request_quest_write, get_cached_quests, request_quest_state } from "./quest_socket.js";

const MODULE_ID = "dc-npc-patrols";

export function create_quest_editor_state() {
	return {
		selected_def_id: null,
		working_def: null,
		selected_posse_id: null,
		selected_posse_quest_id: null,
		working_instance: null,
	};
}

export class QuestEditorController {
	constructor() {
		Object.assign(this, create_quest_editor_state());
	}

	async prepare_context() {
		const defs = get_quest_defs();
		const quest_defs = Object.values(defs).map((d) => ({ id: d.id, title: d.title || "(unnamed)" }));

		// Working def (deep clone so edits don't leak until save)
		let working_def = null;
		if (this.selected_def_id && defs[this.selected_def_id]) {
			if (!this.working_def || this.working_def.id !== this.selected_def_id) {
				this.working_def = foundry.utils.deepClone(defs[this.selected_def_id]);
			}
			working_def = this.working_def;
			working_def.stages_text = (working_def.stages || []).join("\n");
		}

		// Posse section
		const posses = game.dc?.posse?.list?.() ?? [];
		let posse_quests = [];
		let working_instance = null;

		if (this.selected_posse_id) {
			request_quest_state(this.selected_posse_id);
			posse_quests = Object.values(get_cached_quests(this.selected_posse_id)).map((q) => ({
				id: q.id,
				title: q.title || q.id,
				completed: !!q.completed,
			}));
			if (this.selected_posse_quest_id) {
				const raw_quests = get_cached_quests(this.selected_posse_id);
				const raw = raw_quests[this.selected_posse_quest_id];
				if (raw && (!this.working_instance || this.working_instance.id !== raw.id)) {
					this.working_instance = this._build_instance_context(raw);
				}
				working_instance = this.working_instance;
			} else {
				this.working_instance = null;
			}
		}

		return {
			quest_defs,
			selected_def_id: this.selected_def_id,
			working_def,
			posses,
			selected_posse_id: this.selected_posse_id,
			posse_quests,
			selected_posse_quest_id: this.selected_posse_quest_id,
			working_instance,
		};
	}

	/**
	 * Build the form context for one quest instance: stage slider bounds and
	 * one field per declared var, coerced values.
	 */
	_build_instance_context(raw) {
		const def = get_quest_def(raw.id);
		const var_decls = def?.vars || [];
		const stages = raw.stages || [];
		const var_fields = var_decls.map((v) => ({
			key: v.key,
			type: v.type || "text",
			value: raw.vars?.[v.key] ?? (v.type === "number" ? 0 : (v.type === "boolean" ? false : "")),
		}));
		// Also expose instance vars not declared on the def (snapshot drift).
		for (const [key, value] of Object.entries(raw.vars || {})) {
			if (var_fields.some((f) => f.key === key)) continue;
			var_fields.push({ key, type: typeof value === "number" ? "number" : (typeof value === "boolean" ? "boolean" : "text"), value });
		}
		return {
			...foundry.utils.deepClone(raw),
			max_stage: stages.length,
			var_fields,
			completed: !!raw.completed,
		};
	}

	wire_events(html, host) {
		html.querySelectorAll("[data-quest-def-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-quest-def-delete]")) return;
				this.selected_def_id = ev.currentTarget.dataset.questDefSelect;
				this.working_def = null;
				this.selected_posse_quest_id = null;
				this.working_instance = null;
				host.render();
			});
		});

		html.querySelectorAll("[data-quest-def-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const id = ev.currentTarget.dataset.questDefDelete;
				const confirmed = await foundry.applications.api.DialogV2.confirm({
					content: game.i18n.localize("dc-npc-patrols.quests.delete_def_confirm"),
				});
				if (!confirmed) return;
				await delete_quest_def(id);
				if (this.selected_def_id === id) {
					this.selected_def_id = null;
					this.working_def = null;
				}
				host.render();
			});
		});

		html.querySelector("[data-action='quest-add-def']")?.addEventListener("click", async () => {
			const saved = await save_quest_def(make_quest_def());
			this.selected_def_id = saved.id;
			this.working_def = null;
			host.render();
		});

		// Def form fields — edit the working copy, save on button.
		html.querySelectorAll("[data-quest-def-field]").forEach((el) => {
			el.addEventListener("change", () => {
				if (!this.working_def) return;
				const field = el.dataset.questDefField;
				if (field === "stages") {
					this.working_def.stages = el.value.split("\n").map((s) => s.trim()).filter(Boolean);
				} else {
					this.working_def[field] = el.value;
				}
			});
		});

		html.querySelectorAll("[data-quest-var-key]").forEach((el) => {
			el.addEventListener("change", () => {
				this.working_def.vars[Number(el.dataset.questVarKey)].key = el.value;
			});
		});
		html.querySelectorAll("[data-quest-var-type]").forEach((el) => {
			el.addEventListener("change", () => {
				this.working_def.vars[Number(el.dataset.questVarType)].type = el.value;
			});
		});
		html.querySelectorAll("[data-quest-var-default]").forEach((el) => {
			el.addEventListener("change", () => {
				const v = this.working_def.vars[Number(el.dataset.questVarDefault)];
				v.default = this._coerce_by_type(el.value, v.type);
			});
		});
		html.querySelectorAll("[data-quest-var-delete]").forEach((el) => {
			el.addEventListener("click", () => {
				this.working_def.vars.splice(Number(el.dataset.questVarDelete), 1);
				host.render();
			});
		});
		html.querySelector("[data-action='quest-add-var']")?.addEventListener("click", () => {
			if (!this.working_def) return;
			this.working_def.vars = this.working_def.vars || [];
			this.working_def.vars.push({ key: "", type: "text", default: "" });
			host.render();
		});

		html.querySelector("[data-action='quest-save-def']")?.addEventListener("click", async () => {
			if (!this.working_def) return;
			// stages_text was folded into stages by the change handler; drop it
			// before persisting so defs stay shape-clean.
			const { stages_text, ...def } = foundry.utils.deepClone(this.working_def);
			await save_quest_def(def);
			ui.notifications.info(game.i18n.localize("dc-npc-patrols.quests.saved"));
			host.render();
		});

		// ── Posse state section ─────────────────────────────────────
		html.querySelector("[data-quest-posse-select]")?.addEventListener("change", (ev) => {
			this.selected_posse_id = ev.currentTarget.value || null;
			this.selected_posse_quest_id = null;
			this.working_instance = null;
			if (this.selected_posse_id) request_quest_state(this.selected_posse_id);
			host.render();
		});

		html.querySelectorAll("[data-posse-quest-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				if (ev.target.closest("[data-posse-quest-delete]")) return;
				this.selected_posse_quest_id = ev.currentTarget.dataset.posseQuestSelect;
				this.working_instance = null;
				host.render();
			});
		});

		html.querySelectorAll("[data-posse-quest-delete]").forEach((el) => {
			el.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				if (!this.selected_posse_id) return;
				const quest_id = ev.currentTarget.dataset.posseQuestDelete;
				await request_quest_write("delete", { posse_id: this.selected_posse_id, quest_id });
				if (this.selected_posse_quest_id === quest_id) {
					this.selected_posse_quest_id = null;
					this.working_instance = null;
				}
				host.render();
			});
		});

		html.querySelector("[data-action='quest-save-instance']")?.addEventListener("click", async () => {
			if (!this.working_instance || !this.selected_posse_id) return;
			const raw = get_cached_quests(this.selected_posse_id)[this.working_instance.id];
			if (!raw) return;
			const updated = foundry.utils.deepClone(raw);
			updated.stage = Math.max(0, Math.min(Number(this.working_instance.stage) || 0, updated.stages?.length || 0));
			updated.completed = this.working_instance.completed ? this._campaign_day_or(raw.completed) : null;
			updated.vars = updated.vars || {};
			for (const f of this.working_instance.var_fields) {
				updated.vars[f.key] = this._coerce_by_type(f.value, f.type);
			}
			await request_quest_write("set", { posse_id: this.selected_posse_id, quest_id: updated.id, data: updated });
			ui.notifications.info(game.i18n.localize("dc-npc-patrols.quests.saved"));
			host.render();
		});

		// Instance form fields → working copy (saved via the button).
		html.querySelectorAll("[data-quest-instance-field]").forEach((el) => {
			el.addEventListener("change", () => {
				if (!this.working_instance) return;
				const field = el.dataset.questInstanceField;
				if (field === "completed") {
					this.working_instance.completed = el.checked;
				} else {
					this.working_instance[field] = Number(el.value);
				}
			});
		});
		html.querySelectorAll("[data-quest-instance-var]").forEach((el) => {
			el.addEventListener("change", () => {
				if (!this.working_instance) return;
				const key = el.dataset.questInstanceVar;
				const field = this.working_instance.var_fields.find((f) => f.key === key);
				if (!field) return;
				field.value = el.type === "checkbox" ? el.checked : el.value;
			});
		});
	}

	_coerce_by_type(raw, type) {
		if (type === "number") return Number(raw) || 0;
		if (type === "boolean") return raw === true || raw === "true" || raw === "on";
		return String(raw ?? "");
	}

	_campaign_day_or(fallback) {
		return fallback ?? new Date().toISOString().slice(0, 10);
	}
}