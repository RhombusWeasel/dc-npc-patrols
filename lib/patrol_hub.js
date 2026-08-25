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
import { build_dialog_variable_fields } from "./dialog_fragments.js";
import { get_trees as get_dialog_trees } from "./dialog_tree_store.js";
import { get_hub_npc_tokens } from "./hub_scene_cache.js";
import { get_actor_from_token } from "./token_actor.js";
import { DialogEditorController } from "./dialog_editor.js";
import { AmbientEditorController } from "./ambient_editor.js";
import { BTEditorController } from "./bt_editor.js";
import { analyze_bt_vision_requirements, enable_token_vision } from "./bt_vision_requirements.js";

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
			render: () => this.render(),
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

	async _prepare_npc_context(selected_actor) {
		const bts = get_bts();
		const fragment_suffix = game.i18n.localize("dc-npc-patrols.bt.fragment_badge");
		const available_bts = Object.values(bts).map((t) => {
			const base = t.name || "(unnamed)";
			const name = normalize_bt_kind(t.kind) === BT_KIND_FRAGMENT
				? `${base} ${fragment_suffix}`
				: base;
			return { id: t.id, name };
		});
		const assigned_bt_id = selected_actor.getFlag("dc-npc-patrols", "bt_id") || "";
		const bt_variable_fields = assigned_bt_id
			? build_variable_fields(selected_actor, assigned_bt_id)
			: [];

		// Per-actor dialog variable overrides: collect from all attached dialog trees.
		const dialog_att = selected_actor.getFlag("dc-npc-patrols", "dialog_attachments") || [];
		const dialog_trees = get_dialog_trees();
		const dialog_variable_fields = [];
		const seen_vars = new Set();
		for (const att of dialog_att) {
			const tree = att.tree_id ? dialog_trees[att.tree_id] : null;
			if (!tree) continue;
			for (const f of build_dialog_variable_fields(selected_actor, tree)) {
				if (seen_vars.has(f.key)) continue;
				seen_vars.add(f.key);
				dialog_variable_fields.push(f);
			}
		}
		// Remember defs for the save handler (type coercion per key).
		this._dialog_var_defs_by_key = Object.fromEntries(
			dialog_variable_fields.map((f) => [f.key, f])
		);

		const token_doc = this._selected_token_doc();
		let token_settings = null;
		let bt_vision = null;
		let vision_ok = true;
		let vision_needs_range = false;
		let bt_vision_message = "";

		if (token_doc) {
			const sight_enabled = token_doc.sight?.enabled ?? false;
			const sight_range = Number(token_doc.sight?.range) || 0;
			token_settings = {
				sight_enabled,
				sight_range,
				hidden: token_doc.hidden ?? false,
			};

			if (assigned_bt_id) {
				bt_vision = analyze_bt_vision_requirements(assigned_bt_id, bts);
				vision_ok = !bt_vision.requires_vision || sight_enabled;
				vision_needs_range = bt_vision.requires_vision && sight_enabled && sight_range <= 0;
				if (bt_vision.requires_vision) {
					bt_vision_message = game.i18n.format(
						"dc-npc-patrols.hub.token_settings.vision_required",
						{ count: bt_vision.node_count, nodes: bt_vision.node_labels.join(", ") },
					);
				}
			}
		}

		const attachment_ctx = await prepare_attachment_context(selected_actor);

		return {
			selected_actor,
			available_bts,
			assigned_bt_id,
			bt_variable_fields,
			dialog_variable_fields,
			token_settings,
			bt_vision,
			vision_ok,
			vision_needs_range,
			bt_vision_message,
			...attachment_ctx,
		};
	}

	async _prepareContext(_options) {
		const scene = canvas.scene;
		const npc_tokens = get_hub_npc_tokens(scene);
		const selected_actor = this._active_view === "npc" ? this._selected_actor() : null;

		const ctx = {
			active_view: this._active_view,
			npc_tokens,
			selected_actor,
			selected_actor_id: this._selected_actor_id,
			selected_token_id: this._selected_token_id,
			is_gm: game.user.isGM,
			hub_mode: true,
		};

		if (this._active_view === "scene") {
			ctx.weather = scene?.getFlag("dc-npc-patrols", "weather") || "clear";
			ctx.bt_paused = game.settings.get("dc-npc-patrols", "bt_paused") || false;
			const path_debug = window.dcNpcPatrols?.path_debug;
			ctx.path_debug_active = path_debug?._active || false;
		}

		if (this._active_view === "npc" && selected_actor) {
			Object.assign(ctx, await this._prepare_npc_context(selected_actor));
		}

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
				this.render();
			});
		});

		html.querySelectorAll("[data-actor-select]").forEach((el) => {
			el.addEventListener("click", () => {
				this._selected_actor_id = el.dataset.actorSelect;
				this._selected_token_id = el.dataset.tokenSelect || null;
				this._active_view = "npc";
				this.render();
			});
		});

		html.querySelectorAll("[data-nav-world]").forEach((el) => {
			el.addEventListener("click", () => {
				this._active_view = el.dataset.navWorld;
				this.render();
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
			this.render();
		});

		html.querySelector("[data-action='toggle-path-debug']")?.addEventListener("click", () => {
			const path_debug = window.dcNpcPatrols?.path_debug;
			if (path_debug) {
				path_debug.toggle();
				this.render();
			}
		});
	}

	_wire_npc_events(html) {
		const selected_actor = this._selected_actor();
		const region_manager = game.modules.get("dc-npc-patrols")?.api?.region_manager;

		if (region_manager) {
			wire_attachment_events(html, selected_actor, region_manager, () => this.render());
		}

		html.querySelector("[data-bt-assign]")?.addEventListener("change", async (ev) => {
			const actor = this._selected_actor();
			if (!actor) return;
			const bt_id = ev.currentTarget.value || null;
			await actor.setFlag("dc-npc-patrols", "bt_id", bt_id);
			this.render();
		});
		html.querySelectorAll("[data-dialog-var]").forEach((el) => {
			if (el.dataset.wired) return;
			el.dataset.wired = "1";
			el.addEventListener("change", async () => {
				const actor = this._selected_actor();
				if (!actor) return;
				const key = el.dataset.dialogVar;
				const def = this._dialog_var_defs_by_key?.[key];
				const val = def?.type === "boolean" ? el.checked : (def?.type === "number" ? Number(el.value) : el.value);
				const vars = foundry.utils.duplicate(actor.getFlag("dc-npc-patrols", "dialog_variables") || {});
				if (val === "" || val === null || val === undefined) delete vars[key];
				else vars[key] = val;
				await actor.setFlag("dc-npc-patrols", "dialog_variables", vars);
			});
		});

		html.querySelector("[data-action='edit-assigned-bt']")?.addEventListener("click", () => {
			const actor = this._selected_actor();
			const bt_id = actor?.getFlag("dc-npc-patrols", "bt_id");
			if (bt_id) this._navigate_to_world_bt(bt_id);
		});

		html.querySelector("[data-action='enable-token-vision']")?.addEventListener("click", async () => {
			const token_doc = this._selected_token_doc();
			if (!token_doc) return;
			await enable_token_vision(token_doc);
			ui.notifications.info(game.i18n.localize("dc-npc-patrols.hub.token_settings.vision_enabled_notify"));
			this.render();
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
		this.render();
	}
}

/** Backward-compatible alias */
export const PatrolManagerPanel = PatrolHub;
