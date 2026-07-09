/**
 * patrol_manager_panel.js — GM-facing ApplicationV2 panel for editing NPC patrol paths.
 *
 * Shows a list of all NPC tokens on the current scene that have patrol data,
 * allows selecting one, and editing its paths/waypoints.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PatrolManagerPanel extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dc-patrol-manager",
		classes: ["dc-patrol-manager"],
		tag: "div",
		window: {
			title: "dc-npc-patrols.panel.title",
			icon: "fa-solid fa-route",
			resizable: true,
		},
		position: {
			width: 700,
			height: 600,
		},
		template: "modules/dc-npc-patrols/templates/patrol-manager.hbs",
	};

	static PARTS = {
		main: { template: "modules/dc-npc-patrols/templates/patrol-manager.hbs" },
	};

	// --- Track which actor is selected ---
	_selected_actor_id = null;

	async _prepareContext(options) {
		// Find all NPC tokens on the current scene with patrol data
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

		// Get selected actor's patrol data
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

		// Build days labels
		const day_labels = [
			{ key: 0, label: "dc-npc-patrols.panel.day_sun" },
			{ key: 1, label: "dc-npc-patrols.panel.day_mon" },
			{ key: 2, label: "dc-npc-patrols.panel.day_tue" },
			{ key: 3, label: "dc-npc-patrols.panel.day_wed" },
			{ key: 4, label: "dc-npc-patrols.panel.day_thu" },
			{ key: 5, label: "dc-npc-patrols.panel.day_fri" },
			{ key: 6, label: "dc-npc-patrols.panel.day_sat" },
		];

		// Get available scenes for cross-scene waypoints
		const scenes = game.scenes.map((s) => ({ id: s.id, name: s.name }));

		// Pre-compute day states for each path (avoids fragile @../this.days in template)
		const day_keys = [0, 1, 2, 3, 4, 5, 6];
		for (const path of paths) {
			if (!path.days) path.days = [];
			path.day_states = day_keys.map((k) => ({
				key: k,
				label: day_labels[k].label,
				checked: path.days.includes(k),
			}));
		}

		return {
			npc_tokens,
			selected_actor,
			selected_actor_id: this._selected_actor_id,
			paths,
			combat_behavior,
			day_labels,
			scenes,
			is_gm: game.user.isGM,
		};
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;

		// Actor selection
		html.querySelectorAll("[data-actor-select]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				this._selected_actor_id = ev.currentTarget.dataset.actorSelect;
				this.render();
			});
		});

		// Add path
		html.querySelector("[data-action='add-path']")?.addEventListener("click", () => {
			this._add_path();
		});

		// Add waypoint
		html.querySelectorAll("[data-add-waypoint]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				const path_idx = parseInt(ev.currentTarget.dataset.addWaypoint, 10);
				this._add_waypoint(path_idx);
			});
		});

		// Delete waypoint
		html.querySelectorAll("[data-delete-waypoint]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				const [path_idx, wp_idx] = ev.currentTarget.dataset.deleteWaypoint.split(":").map(Number);
				this._delete_waypoint(path_idx, wp_idx);
			});
		});

		// Delete path
		html.querySelectorAll("[data-delete-path]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				const path_idx = parseInt(ev.currentTarget.dataset.deletePath, 10);
				this._delete_path(path_idx);
			});
		});

		// Toggle path enabled
		html.querySelectorAll("[data-toggle-path]").forEach((el) => {
			el.addEventListener("change", (ev) => {
				const path_idx = parseInt(ev.currentTarget.dataset.togglePath, 10);
				this._toggle_path(path_idx, ev.currentTarget.checked);
			});
		});

		// Day checkbox changes
		html.querySelectorAll("[data-day-toggle]").forEach((el) => {
			el.addEventListener("change", (ev) => {
				const [path_idx, day_idx] = ev.currentTarget.dataset.dayToggle.split(":").map(Number);
				this._toggle_day(path_idx, day_idx, ev.currentTarget.checked);
			});
		});

		// Combat behavior change
		html.querySelector("[data-combat-behavior]")?.addEventListener("change", (ev) => {
			this._set_combat_behavior(ev.currentTarget.value);
		});

		// Record path
		html.querySelectorAll("[data-record-path]").forEach((el) => {
			el.addEventListener("click", (ev) => {
				const path_idx = parseInt(ev.currentTarget.dataset.recordPath, 10);
				this._record_path(path_idx);
			});
		});

		// Save all changes (field blur saves automatically, but provide a save button)
		html.querySelector("[data-action='save']")?.addEventListener("click", () => {
			this._save_all();
		});
	}

	// --- Path operations (work on in-memory copy, then save) ---
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
		this.render();
	}

	async _add_path() {
		const paths = await this._get_paths();
		paths.push({
			name: `Path ${paths.length + 1}`,
			enabled: true,
			days: [],
			waypoints: [],
		});
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
		// Sort days
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
		// Collect all field values from the form
		const html = this.element;
		if (!this._selected_actor_id) return;

		const paths = await this._get_paths();

		// Path names
		html.querySelectorAll("[data-path-name]").forEach((el) => {
			const idx = parseInt(el.dataset.pathName, 10);
			if (paths[idx]) paths[idx].name = el.value;
		});

		// Waypoint fields
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
			wp[field] = value;
		});

		await this._save_paths(paths);
	}

	// --- Record a path by dragging the token (Phase 2) ---
	async _record_path(path_idx) {
		const actor = game.actors.get(this._selected_actor_id);
		if (!actor) return;

		// Find the token on the current scene
		const token_doc = canvas.scene?.tokens.find((t) => t.actor?.id === actor.id);
		if (!token_doc) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.panel.no_token_on_scene"));
			return;
		}
		const token = token_doc.object; // Token placeable
		if (!token) {
			ui.notifications.warn(game.i18n.localize("dc-npc-patrols.panel.no_token_on_scene"));
			return;
		}

		// Minimize panel so GM can interact with canvas
		this.minimize();

		const { record_path } = await import("./path_recorder.js");
		await record_path(token, {
			on_complete: async (waypoints) => {
				const paths = await this._get_paths();
				if (paths[path_idx]) {
					paths[path_idx].waypoints = waypoints;
					await this._save_paths(paths);
				}
				this.maximize();
				ui.notifications.info(
					game.i18n.format("dc-npc-patrols.panel.recording_complete", { count: waypoints.length })
				);
			},
			on_cancel: () => {
				this.maximize();
				ui.notifications.info(game.i18n.localize("dc-npc-patrols.panel.recording_cancelled"));
			},
		});
	}
}