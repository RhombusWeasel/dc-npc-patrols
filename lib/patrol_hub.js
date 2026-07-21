/**
 * patrol_hub.js — Unified NPC Patrol Hub (ApplicationV2).
 *
 * Single window for scene controls, world content editors, and per-NPC config.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import { prepare_attachment_context, wire_attachment_events } from "./attachment_editor.js";
import { get_bts } from "./bt_store.js";
import { normalize_bt_kind, BT_KIND_FRAGMENT } from "./bt_kinds.js";
import { build_variable_fields } from "./bt_variables.js";
import { wire_hub_bt_variable_events } from "./actor_behaviour_tab.js";
import { get_actor_from_token } from "./token_actor.js";
import { DialogEditorController } from "./dialog_editor.js";
import { AmbientEditorController } from "./ambient_editor.js";
import { BTEditorController } from "./bt_editor.js";

export class PatrolHub extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dc-patrol-hub",
		classes: ["dc-patrol-hub-app"],
		tag: "div",
		window: {
			title: "dc-npc-patrols.hub.title",
			icon: "fa-solid fa-route",
			resizable: true,
		},
		position: {
			width: 1000,
			height: 750,
		},
	};

	static PARTS = {
		main: { template: "modules/dc-npc-patrols/templates/patrol-hub.hbs" },
	};

	_active_view = "npc";
	_selected_actor_id = null;
	_selected_token_id = null;
	_movement_expanded = false;

	_dialog_ctrl = new DialogEditorController();
	_ambient_ctrl = new AmbientEditorController();
	_bt_ctrl = new BTEditorController();

	_host() {
		return {
			element: this.element,
			render: () => this.render({ force: true }),
		};
	}

	_selected_token_doc() {
		const scene = canvas.scene;
		if (!scene || !this._selected_token_id) return null;
		return scene.tokens.get(this._selected_token_id) ?? null;
	}

	_selected_actor() {
		return get_actor_from_token(this._selected_token_doc());
	}

	/** Open hub focused on an actor; optionally jump to world BT editor. */
	focus_actor(actor_id, { bt_id = null, token_id = null } = {}) {
		this._selected_actor_id = actor_id;
		if (token_id) {
			this._selected_token_id = token_id;
		} else {
			const scene = canvas.scene;
			const doc = scene?.tokens.find((t) => t.actor?.id === actor_id);
			this._selected_token_id = doc?.id ?? null;
		}
		if (bt_id) {
			this._active_view = "world_bt";
			this._bt_ctrl.selected_bt_id = bt_id;
			this._bt_ctrl.working_bt = null;
		} else {
			this._active_view = "npc";
		}
	}

	async _prepareContext(_options) {
		const scene = canvas.scene;
		const npc_tokens = [];

		if (scene) {
			for (const token_doc of scene.tokens) {
				const actor = token_doc.actor;
				if (!actor) continue;
				npc_tokens.push({
					id: actor.id,
					name: token_doc.name || actor.name,
					token_id: token_doc.id,
				});
			}
		}

		let selected_actor = null;

		selected_actor = this._selected_actor();

		const scenes = game.scenes.map((s) => ({ id: s.id, name: s.name }));

		const attachment_ctx = await prepare_attachment_context(selected_actor);
		const bts = get_bts();
		const fragment_suffix = game.i18n.localize("dc-npc-patrols.bt.fragment_badge");
		const available_bts = Object.values(bts).map((t) => {
			const base = t.name || "(unnamed)";
			const name = normalize_bt_kind(t.kind) === BT_KIND_FRAGMENT
				? `${base} ${fragment_suffix}`
				: base;
			return { id: t.id, name };
		});
		const assigned_bt_id = selected_actor?.getFlag("dc-npc-patrols", "bt_id") || "";
		const bt_variable_fields = (selected_actor && assigned_bt_id)
			? build_variable_fields(selected_actor, assigned_bt_id)
			: [];
		const weather = scene?.getFlag("dc-npc-patrols", "weather") || "clear";
		const bt_paused = game.settings.get("dc-npc-patrols", "bt_paused") || false;
		const path_debug = window.dcNpcPatrols?.path_debug;
		const path_debug_active = path_debug?._active || false;

		const ctx = {
			active_view: this._active_view,
			npc_tokens,
			selected_actor,
			selected_actor_id: this._selected_actor_id,
			selected_token_id: this._selected_token_id,
			scenes,
			is_gm: game.user.isGM,
			available_bts,
			assigned_bt_id,
			bt_variable_fields,
			weather,
			bt_paused,
			path_debug_active,
			hub_mode: true,
			...attachment_ctx,
		};

		if (this._active_view === "world_dialog") {
			Object.assign(ctx, await this._dialog_ctrl.prepare_context());
		} else if (this._active_view === "world_ambient") {
			Object.assign(ctx, await this._ambient_ctrl.prepare_context());
		} else if (this._active_view === "world_bt") {
			Object.assign(ctx, await this._bt_ctrl.prepare_context());
		}

		return ctx;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;
		const host = this._host();

		html.querySelectorAll("[data-view-select]").forEach((el) => {
			el.addEventListener("click", () => {
				this._active_view = el.dataset.viewSelect;
				this.render({ force: true });
			});
		});

		html.querySelectorAll("[data-actor-select]").forEach((el) => {
			el.addEventListener("click", () => {
				this._selected_actor_id = el.dataset.actorSelect;
				this._selected_token_id = el.dataset.tokenSelect || null;
				this._active_view = "npc";
				this.render({ force: true });
			});
		});

		html.querySelectorAll("[data-nav-world]").forEach((el) => {
			el.addEventListener("click", () => {
				this._active_view = el.dataset.navWorld;
				this.render({ force: true });
			});
		});

		if (this._active_view === "scene") {
			this._wire_scene_events(html);
		} else if (this._active_view === "world_dialog") {
			this._dialog_ctrl.wire_events(html, host);
		} else if (this._active_view === "world_ambient") {
			this._ambient_ctrl.wire_events(html, host);
		} else if (this._active_view === "world_bt") {
			this._bt_ctrl.wire_events(html, host);
		} else if (this._active_view === "npc") {
			this._wire_npc_events(html);
		}
	}

	_wire_scene_events(html) {
		html.querySelector("[data-weather-set]")?.addEventListener("change", async (ev) => {
			const scene = canvas.scene;
			if (!scene) return;
			await scene.setFlag("dc-npc-patrols", "weather", ev.currentTarget.value);
		});

		html.querySelector("[data-action='toggle-bt-pause']")?.addEventListener("click", async () => {
			const current = game.settings.get("dc-npc-patrols", "bt_paused") || false;
			await game.settings.set("dc-npc-patrols", "bt_paused", !current);
			ui.notifications.info(!current ? "Behaviour trees paused." : "Behaviour trees resumed.");
			this.render({ force: true });
		});

		html.querySelector("[data-action='toggle-path-debug']")?.addEventListener("click", () => {
			const path_debug = window.dcNpcPatrols?.path_debug;
			if (path_debug) {
				path_debug.toggle();
				this.render({ force: true });
			}
		});
	}

	_wire_npc_events(html) {
		const selected_actor = this._selected_actor();
		const region_manager = game.modules.get("dc-npc-patrols")?.api?.region_manager;

		if (region_manager) {
			wire_attachment_events(html, selected_actor, region_manager, () => this.render({ force: true }));
		}

		html.querySelector("[data-bt-assign]")?.addEventListener("change", async (ev) => {
			const actor = this._selected_actor();
			if (!actor) return;
			const bt_id = ev.currentTarget.value || null;
			await actor.setFlag("dc-npc-patrols", "bt_id", bt_id);
			this.render({ force: true });
		});

		html.querySelector("[data-action='edit-assigned-bt']")?.addEventListener("click", () => {
			const actor = this._selected_actor();
			const bt_id = actor?.getFlag("dc-npc-patrols", "bt_id");
			if (bt_id) this._navigate_to_world_bt(bt_id);
		});

		const actor = this._selected_actor();
		const bt_id = actor?.getFlag("dc-npc-patrols", "bt_id");
		if (actor && bt_id) {
			wire_hub_bt_variable_events(html, actor, bt_id, this._selected_token_doc());
		}
	}

	_navigate_to_world_bt(bt_id) {
		this._active_view = "world_bt";
		this._bt_ctrl.selected_bt_id = bt_id;
		this._bt_ctrl.working_bt = null;
		this.render({ force: true });
	}
}

/** Backward-compatible alias */
export const PatrolManagerPanel = PatrolHub;
