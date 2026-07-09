/**
 * dc-npc-patrols — main.js
 * NPC Patrols & Dialog module for Deadlands-Classic
 *
 * Entry point: settings, scene control button, time polling,
 * and API exposure.
 */

import { PatrolEngine } from "./lib/patrol_engine.js";
import { CrossScene } from "./lib/cross_scene.js";
import { RegionManager } from "./lib/region_manager.js";
import { PatrolManagerPanel } from "./lib/patrol_manager_panel.js";

// --- Module globals ---
const MODULE_ID = "dc-npc-patrols";
let _engine = null;
let _panel = null;
let _last_unixtime = null;
let _poll_interval = null;

// --- Default settings ---
const DEFAULTS = {
	enable_patrols: true,
	movement_speed: 600,
	stagger_delay: 80,
	proximity_radius: 2,
	ambient_cooldown: 30,
	combat_freeze: true,
};

function register_settings() {
	game.settings.register(MODULE_ID, "enable_patrols", {
		name: game.i18n.localize("dc-npc-patrols.settings.enable_patrols.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.enable_patrols.hint"),
		scope: "world",
		config: true,
		type: Boolean,
		default: DEFAULTS.enable_patrols,
	});

	game.settings.register(MODULE_ID, "movement_speed", {
		name: game.i18n.localize("dc-npc-patrols.settings.movement_speed.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.movement_speed.hint"),
		scope: "world",
		config: true,
		type: Number,
		default: DEFAULTS.movement_speed,
	});

	game.settings.register(MODULE_ID, "stagger_delay", {
		name: game.i18n.localize("dc-npc-patrols.settings.stagger_delay.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.stagger_delay.hint"),
		scope: "world",
		config: true,
		type: Number,
		default: DEFAULTS.stagger_delay,
	});

	game.settings.register(MODULE_ID, "proximity_radius", {
		name: game.i18n.localize("dc-npc-patrols.settings.proximity_radius.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.proximity_radius.hint"),
		scope: "world",
		config: true,
		type: Number,
		default: DEFAULTS.proximity_radius,
	});

	game.settings.register(MODULE_ID, "ambient_cooldown", {
		name: game.i18n.localize("dc-npc-patrols.settings.ambient_cooldown.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.ambient_cooldown.hint"),
		scope: "world",
		config: true,
		type: Number,
		default: DEFAULTS.ambient_cooldown,
	});

	game.settings.register(MODULE_ID, "combat_freeze", {
		name: game.i18n.localize("dc-npc-patrols.settings.combat_freeze.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.combat_freeze.hint"),
		scope: "world",
		config: true,
		type: Boolean,
		default: DEFAULTS.combat_freeze,
	});
}

// --- Time polling ---
function start_time_poll() {
	if (_poll_interval) clearInterval(_poll_interval);

	_last_unixtime = game.settings.get("Deadlands-Classic", "unixtime");

	_poll_interval = setInterval(() => {
		const now = game.settings.get("Deadlands-Classic", "unixtime");
		if (now !== _last_unixtime) {
			const old = _last_unixtime;
			_last_unixtime = now;
			if (game.user.isGM) {
				_engine.evaluate_schedules(old, now);
			}
		}
	}, 2000);
}

// --- Scene control button ---
function register_scene_control() {
	Hooks.on("getSceneControlButtons", (controls) => {
		if (!game.user.isGM) return;

		const dc_control = controls.find((c) => c.name === "tokens") || controls.find((c) => c.name === "lighting");
		if (!dc_control) return;

		dc_control.tools.push({
			name: MODULE_ID,
			title: game.i18n.localize("dc-npc-patrols.controls.patrol_manager.title"),
			toggle: true,
			active: false,
			icon: "fa-solid fa-route",
			onClick: (toggle) => {
				if (toggle) {
					open_panel();
				} else {
					close_panel();
				}
			},
		});
	});
}

function open_panel() {
	if (!_panel) {
		_panel = new PatrolManagerPanel();
	}
	_panel.render(true);
}

function close_panel() {
	if (_panel) {
		_panel.close();
		_panel = null;
	}
}

// --- Init ---
// --- Handlebars helpers ---
function register_helpers() {
	Handlebars.registerHelper("includes", (arr, val) => {
		return Array.isArray(arr) && arr.includes(val);
	});
}

Hooks.once("init", () => {
	register_settings();
	register_helpers();
});

Hooks.once("ready", () => {
	// Verify DC system is active
	if (!game.dc) {
		console.warn(`[${MODULE_ID}] Deadlands-Classic system not detected — module disabled.`);
		return;
	}

	// Initialize subsystems
	const cross_scene = new CrossScene(MODULE_ID);
	const region_manager = new RegionManager(MODULE_ID);
	_engine = new PatrolEngine(MODULE_ID, cross_scene, region_manager);

	// Expose module API
	const mod = game.modules.get(MODULE_ID);
	mod.api = {
		engine: _engine,
		cross_scene,
		region_manager,
		open_panel,
		close_panel,
	};
	// Also on window for easy access
	window.dcNpcPatrols = mod.api;

	// Register scene control button
	register_scene_control();

	// Start time polling for schedule evaluation
	start_time_poll();

	console.log(`[${MODULE_ID}] Ready — patrol engine initialized.`);
});