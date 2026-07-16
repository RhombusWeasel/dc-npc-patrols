/**
 * patrol_hub.js — Unified NPC Patrol Hub (ApplicationV2).
 *
 * Single window for scene controls, world content editors, and per-NPC config.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import { prepare_attachment_context, wire_attachment_events } from "./attachment_editor.js";
import { get_bts } from "./bt_store.js";
import { build_variable_fields } from "./bt_variables.js";
import { wire_hub_bt_variable_events } from "./actor_behaviour_tab.js";
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

	/** Open hub focused on an actor; optionally jump to world BT editor. */
	focus_actor(actor_id, { bt_id = null } = {}) {
		this._selected_actor_id = actor_id;
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
				const paths = actor.getFlag("dc-npc-patrols", "paths") || [];
				npc_tokens.push({
					id: actor.id,
					name: token_doc.name || actor.name,
					token_id: token_doc.id,
					path_count: paths.length,
					has_patrol: paths.length > 0,
				});
			}
		}

		let selected_actor = null;
		let paths = [];
		let combat_behavior = "freeze";

		if (this._selected_actor_id) {
			selected_actor = game.actors.get(this._selected_actor_id);
			if (selected_actor) {
				paths = selected_actor.getFlag("dc-npc-patrols", "paths") || [];
				combat_behavior = selected_actor.getFlag("dc-npc-patrols", "combat_behavior") || "freeze";
			}
		}

		const day_labels = [
			{ key: 0, label: "dc-npc-patrols.panel.day_sun" },
			{ key: 1, label: "dc-npc-patrols.panel.day_mon" },
			{ key: 2, label: "dc-npc-patrols.panel.day_tue" },
			{ key: 3, label: "dc-npc-patrols.panel.day_wed" },
			{ key: 4, label: "dc-npc-patrols.panel.day_thu" },
			{ key: 5, label: "dc-npc-patrols.panel.day_fri" },
			{ key: 6, label: "dc-npc-patrols.panel.day_sat" },
		];

		const scenes = game.scenes.map((s) => ({ id: s.id, name: s.name }));
		const day_keys = [0, 1, 2, 3, 4, 5, 6];

		for (const path of paths) {
			if (!path.days) path.days = [];
			path.day_states = day_keys.map((k) => ({
				key: k,
				label: day_labels[k].label,
				checked: path.days.includes(k),
			}));
		}

		const attachment_ctx = await prepare_attachment_context(selected_actor);
		const bts = get_bts();
		const available_bts = Object.values(bts).map((t) => ({ id: t.id, name: t.name || "(unnamed)" }));
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
			paths,
			combat_behavior,
			day_labels,
			scenes,
			is_gm: game.user.isGM,
			available_bts,
			assigned_bt_id,
			bt_variable_fields,
			weather,
			bt_paused,
			path_debug_active,
			movement_expanded: this._movement_expanded,
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
		const selected_actor = this._selected_actor_id ? game.actors.get(this._selected_actor_id) : null;
		const region_manager = game.modules.get("dc-npc-patrols")?.api?.region_manager;

		if (region_manager) {
			wire_attachment_events(html, selected_actor, region_manager, () => this.render({ force: true }));
		}

		html.querySelector(".hub-movement-section")?.addEventListener("toggle", (ev) => {
			this._movement_expanded = ev.currentTarget.open;
		});

		html.querySelector("[data-action='add-path']")?.addEventListener("click", () => {
			this._add_path();
		});

		html.querySelectorAll("[data-add-waypoint]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				this._add_waypoint(parseInt(ev.currentTarget.dataset.addWaypoint, 10));
			});
		});

		html.querySelectorAll("[data-delete-waypoint]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				const [path_idx, wp_idx] = ev.currentTarget.dataset.deleteWaypoint.split(":").map(Number);
				this._delete_waypoint(path_idx, wp_idx);
			});
		});

		html.querySelectorAll("[data-delete-path]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				this._delete_path(parseInt(ev.currentTarget.dataset.deletePath, 10));
			});
		});

		html.querySelectorAll("[data-toggle-path]").forEach((el) => {
			el.addEventListener("change", (ev) => {
				this._toggle_path(parseInt(ev.currentTarget.dataset.togglePath, 10), ev.currentTarget.checked);
			});
		});

		html.querySelectorAll("[data-day-toggle]").forEach((el) => {
			el.addEventListener("change", (ev) => {
				const [path_idx, day_idx] = ev.currentTarget.dataset.dayToggle.split(":").map(Number);
				this._toggle_day(path_idx, day_idx, ev.currentTarget.checked);
			});
		});

		html.querySelector("[data-combat-behavior]")?.addEventListener("change", (ev) => {
			this._set_combat_behavior(ev.currentTarget.value);
		});

		html.querySelectorAll("[data-record-path]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				this._record_path(parseInt(ev.currentTarget.dataset.recordPath, 10));
			});
		});

		html.querySelector("[data-action='save']")?.addEventListener("click", () => {
			this._save_all();
		});

		html.querySelector("[data-bt-assign]")?.addEventListener("change", async (ev) => {
			if (!this._selected_actor_id) return;
			const actor = game.actors.get(this._selected_actor_id);
			if (!actor) return;
			const bt_id = ev.currentTarget.value || null;
			await actor.setFlag("dc-npc-patrols", "bt_id", bt_id);
			this.render({ force: true });
		});

		html.querySelector("[data-action='edit-assigned-bt']")?.addEventListener("click", () => {
			const actor = game.actors.get(this._selected_actor_id);
			const bt_id = actor?.getFlag("dc-npc-patrols", "bt_id");
			if (bt_id) this._navigate_to_world_bt(bt_id);
		});

		const actor = this._selected_actor_id ? game.actors.get(this._selected_actor_id) : null;
		const bt_id = actor?.getFlag("dc-npc-patrols", "bt_id");
		if (actor && bt_id) {
			wire_hub_bt_variable_events(html, actor, bt_id);
		}

		html.querySelectorAll("input[type='checkbox'][data-wp-field]").forEach((el) => {
			el.addEventListener("change", () => this._save_all());
		});
	}

	_navigate_to_world_bt(bt_id) {
		this._active_view = "world_bt";
		this._bt_ctrl.selected_bt_id = bt_id;
		this._bt_ctrl.working_bt = null;
		this.render({ force: true });
	}

	async _get_paths() {
		if (!this._selected_actor_id) return [];
		const actor = game.actors.get(this._selected_actor_id);
		if (!actor) return [];
		return foundry.utils.duplicate(actor.getFlag("dc-npc-patrols", "paths") || []);
	}

	async _save_paths(paths) {
		if (!this._selected_actor_id) return;
		const actor = game.actors.get(this._selected_actor_id);
		if (!actor) return;
		await actor.setFlag("dc-npc-patrols", "paths", paths);
		this.render({ force: true });
	}

	async _add_path() {
		const paths = await this._get_paths();
		paths.push({
			name: `Path ${paths.length + 1}`,
			enabled: true,
			days: [],
			waypoints: [],
		});
		this._movement_expanded = true;
		await this._save_paths(paths);
	}

	async _add_waypoint(path_idx) {
		const paths = await this._get_paths();
		const path = paths[path_idx];
		if (!path) return;
		path.waypoints.push({
			id: `wp_${Date.now()}`,
			label: "",
			x: 0,
			y: 0,
			time: "12:00",
			face_direction: null,
			linger_minutes: 0,
			scene_id: null,
			arrival_lines: [],
			ambient_lines: [],
			region_radius: game.settings.get("dc-npc-patrols", "proximity_radius"),
		});
		this._movement_expanded = true;
		await this._save_paths(paths);
	}

	async _delete_waypoint(path_idx, wp_idx) {
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			content: game.i18n.localize("dc-npc-patrols.panel.delete_confirm"),
		});
		if (!confirmed) return;
		const paths = await this._get_paths();
		paths[path_idx]?.waypoints.splice(wp_idx, 1);
		await this._save_paths(paths);
	}

	async _delete_path(path_idx) {
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			content: game.i18n.localize("dc-npc-patrols.panel.delete_path_confirm"),
		});
		if (!confirmed) return;
		const paths = await this._get_paths();
		paths.splice(path_idx, 1);
		await this._save_paths(paths);
	}

	async _toggle_path(path_idx, enabled) {
		const paths = await this._get_paths();
		if (paths[path_idx]) {
			paths[path_idx].enabled = enabled;
			await this._save_paths(paths);
		}
	}

	async _toggle_day(path_idx, day_idx, checked) {
		const paths = await this._get_paths();
		const path = paths[path_idx];
		if (!path) return;
		if (!path.days) path.days = [];
		if (checked) {
			if (!path.days.includes(day_idx)) path.days.push(day_idx);
		} else {
			path.days = path.days.filter((d) => d !== day_idx);
		}
		path.days.sort((a, b) => a - b);
		await this._save_paths(paths);
	}

	async _set_combat_behavior(value) {
		if (!this._selected_actor_id) return;
		const actor = game.actors.get(this._selected_actor_id);
		if (!actor) return;
		await actor.setFlag("dc-npc-patrols", "combat_behavior", value);
	}

	async _save_all() {
		const html = this.element;
		if (!this._selected_actor_id) return;

		const paths = await this._get_paths();

		html.querySelectorAll("[data-path-name]").forEach((el) => {
			const idx = parseInt(el.dataset.pathName, 10);
			if (paths[idx]) paths[idx].name = el.value;
		});

		html.querySelectorAll("[data-wp-field]").forEach((el) => {
			const [path_idx, wp_idx, field] = el.dataset.wpField.split(":");
			const p = paths[parseInt(path_idx)];
			if (!p) return;
			const wp = p.waypoints[parseInt(wp_idx)];
			if (!wp) return;

			let value = el.value;
			if (field === "x" || field === "y" || field === "face_direction" || field === "linger_minutes" || field === "region_radius") {
				value = value === "" ? null : parseFloat(value);
			}
			if (field === "scene_id") {
				value = value === "" ? null : value;
			}
			if (field === "arrival_lines" || field === "ambient_lines") {
				value = value.split("\n").map((l) => l.trim()).filter((l) => l);
			}
			if (field === "flee_target" || field === "home") {
				value = el.checked;
			}
			wp[field] = value;
		});

		await this._save_paths(paths);
		ui.notifications.info(game.i18n.localize("dc-npc-patrols.hub.saved"));
	}

	async _record_path(path_idx) {
		const actor = game.actors.get(this._selected_actor_id);
		if (!actor) return;

		const token_doc = canvas.scene?.tokens.find((t) => t.actor?.id === actor.id);
		if (!token_doc?.object) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.panel.no_token_on_scene"));
			return;
		}

		this.element.style.display = "none";

		try {
			const { record_path } = await import("./path_recorder.js");
			await record_path(token_doc.object, {
				on_complete: async (waypoint) => {
					const paths = await this._get_paths();
					if (paths[path_idx]) {
						paths[path_idx].waypoints.push(waypoint);
						await this._save_paths(paths);
					}
					this.element.style.display = "";
					this._movement_expanded = true;
					await this.render({ force: true });
					ui.notifications.info(
						game.i18n.format("dc-npc-patrols.panel.recording_complete", {
							count: (waypoint.route?.length || 0) + 1,
						})
					);
				},
				on_cancel: () => {
					this.element.style.display = "";
					ui.notifications.info(game.i18n.localize("dc-npc-patrols.panel.recording_cancelled"));
				},
			});
		} catch (err) {
			console.error("dc-npc-patrols | record_path error:", err);
			this.element.style.display = "";
			ui.notifications.error(game.i18n.localize("dc-npc-patrols.panel.recording_cancelled"));
		}
	}
}

/** Backward-compatible alias */
export const PatrolManagerPanel = PatrolHub;
