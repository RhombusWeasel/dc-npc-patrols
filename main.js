/**
 * dc-npc-patrols — main.js
 * NPC Patrols & Dialog module for Deadlands-Classic
 *
 * Entry point: settings, scene control button, BT tick loop,
 * and API exposure.
 */

import { RegionManager } from "./lib/region_manager.js";
import { PatrolHub } from "./lib/patrol_hub.js";
import { register_dialog_behaviors } from "./lib/dialog_behaviors.js";
import { DialogEditor } from "./lib/dialog_editor.js";
import { AmbientEditor } from "./lib/ambient_editor.js";
import { BTEngine } from "./lib/bt_engine.js";
import { Pathfinding } from "./lib/pathfinding.js";
import { BTEditor } from "./lib/bt_editor.js";
import {
	prepare_behaviour_tab_context,
	wire_behaviour_tab_events,
} from "./lib/actor_behaviour_tab.js";
import { get_default_bts } from "./lib/default_bts.js";
import { PathDebugOverlay } from "./lib/path_debug_overlay.js";
import { clear_active_combat_turn } from "./lib/combat_turn.js";
import { register_combat_flows } from "./lib/bt_combat_flows.js";
import { register_node, register_variable_type, init_bt_nodes } from "./lib/nodes/loader.js";
import { bt_debug_enabled } from "./lib/bt_debug.js";

// --- Module globals ---
const MODULE_ID = "dc-npc-patrols";
let _bt_engine = null;
let _pathfinding = null;
let _path_debug = null;
let _panel = null;
let _bt_tick_interval = null;





const DEFAULTS = {
	enable_patrols: true,
	proximity_radius: 2,
	combat_freeze: true,
	nav_resolution: 4,
	block_tokens: true,
	npc_door_sounds: false,
	bt_tick_interval_ms: 2000,
	bt_combat_debug: false,
	bt_debug: false,
	chat_bubble_scale: 150,
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

	// World-level JSON storage for dialog trees and ambient sets
	game.settings.register(MODULE_ID, "dialog_trees", {
		scope: "world",
		config: false,
		type: Object,
		default: {},
	});

	game.settings.register(MODULE_ID, "ambient_sets", {
		scope: "world",
		config: false,
		type: Object,
		default: {},
	});

	// World-level JSON storage for behaviour trees
	game.settings.register(MODULE_ID, "behaviour_trees", {
		scope: "world",
		config: false,
		type: Object,
		default: {},
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

	game.settings.register(MODULE_ID, "bt_tick_interval_ms", {
		name: game.i18n.localize("dc-npc-patrols.settings.bt_tick_interval_ms.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.bt_tick_interval_ms.hint"),
		scope: "world",
		config: true,
		type: Number,
		range: { min: 500, max: 10000, step: 100 },
		default: DEFAULTS.bt_tick_interval_ms,
		onChange: () => {
			if (_bt_engine) start_bt_tick();
		},
	});

	game.settings.register(MODULE_ID, "bt_combat_debug", {
		name: game.i18n.localize("dc-npc-patrols.settings.bt_combat_debug.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.bt_combat_debug.hint"),
		scope: "world",
		config: true,
		type: Boolean,
		default: DEFAULTS.bt_combat_debug,
	});

	game.settings.register(MODULE_ID, "bt_debug", {
		name: game.i18n.localize("dc-npc-patrols.settings.bt_debug.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.bt_debug.hint"),
		scope: "world",
		config: true,
		type: Boolean,
		default: DEFAULTS.bt_debug,
	});

	game.settings.register(MODULE_ID, "nav_resolution", {
		name: game.i18n.localize("dc-npc-patrols.settings.nav_resolution.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.nav_resolution.hint"),
		scope: "world",
		config: true,
		type: Number,
		default: DEFAULTS.nav_resolution,
		onChange: () => {
			if (_pathfinding) {
				for (const scene of game.scenes) {
					_pathfinding.invalidate(scene.id);
				}
			}
		},
	});

	game.settings.register(MODULE_ID, "npc_door_sounds", {
		name: game.i18n.localize("dc-npc-patrols.settings.npc_door_sounds.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.npc_door_sounds.hint"),
		scope: "world",
		config: true,
		type: Boolean,
		default: DEFAULTS.npc_door_sounds,
	});

	game.settings.register(MODULE_ID, "block_tokens", {
		name: game.i18n.localize("dc-npc-patrols.settings.block_tokens.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.block_tokens.hint"),
		scope: "world",
		config: true,
		type: Boolean,
		default: DEFAULTS.block_tokens,
		onChange: () => {
			if (_pathfinding) {
				for (const scene of game.scenes) {
					_pathfinding.invalidate_paths(scene.id);
				}
			}
		},
	});

	game.settings.register(MODULE_ID, "bt_paused", {
		scope: "world",
		config: false,
		type: Boolean,
		default: false,
	});

	game.settings.register(MODULE_ID, "chat_bubble_scale", {
		name: game.i18n.localize("dc-npc-patrols.settings.chat_bubble_scale.name"),
		hint: game.i18n.localize("dc-npc-patrols.settings.chat_bubble_scale.hint"),
		scope: "client",
		config: true,
		type: Number,
		range: { min: 100, max: 300, step: 10 },
		default: DEFAULTS.chat_bubble_scale,
		onChange: apply_bubble_scale,
	});
}

// --- Chat bubble scaling ---
const BUBBLE_STYLE_ID = "dc-npc-patrols-bubble-scale";

function apply_bubble_scale() {
	const pct = game.settings.get(MODULE_ID, "chat_bubble_scale") ?? DEFAULTS.chat_bubble_scale;
	const scale = pct / 100;
	let el = document.getElementById(BUBBLE_STYLE_ID);
	if (!el) {
		el = document.createElement("style");
		el.id = BUBBLE_STYLE_ID;
		document.head.appendChild(el);
	}
	// Target .chat-bubble globally (not just #chat-bubbles) because Foundry's ChatBubbles
	// measures dimensions using a hidden temp div appended to <body>, then sets inline
	// width/height on the real bubble from those measurements. The temp div must get the
	// same scaling or it measures at default size and locks the container to unscaled dims.
	// !important is needed to override the inline styles set by #setPosition().
	// color is darkened from Foundry's default (--color-text-primary = #222) to #111 for
	// better readability on the cream bubble background.
	el.textContent = `.chat-bubble {
		font-size: ${scale}rem !important;
		max-width: ${Math.round(400 * scale)}px !important;
		max-height: ${Math.round(100 * scale)}px !important;
		min-width: ${Math.round(100 * scale)}px !important;
		padding: ${Math.round(8 * scale)}px !important;
		color: #111 !important;
	}`;
}

// --- BT tick loop (independent of game time) ---
function start_bt_tick() {
	if (_bt_tick_interval) clearInterval(_bt_tick_interval);

	const interval_ms = Math.max(
		500,
		Math.min(10000, game.settings.get(MODULE_ID, "bt_tick_interval_ms") || DEFAULTS.bt_tick_interval_ms),
	);

	const dbg = game.settings.get(MODULE_ID, "bt_debug");
	console.log(`[dc-npc-patrols|bt:loop] starting tick loop, interval=${interval_ms}ms, engine=${_bt_engine ? "ready" : "null"}, bt_debug=${dbg}, isGM=${game.user.isGM}`);

	_bt_tick_interval = setInterval(async () => {
		if (!game.user.isGM) return;
		if (!game.settings.get(MODULE_ID, "bt_paused")) {
			if (_bt_engine) {
				try {
					await _bt_engine.tick();
				} catch (err) {
					console.error(`[dc-npc-patrols|bt:loop] tick threw:`, err);
				}
			} else {
				console.warn(`[dc-npc-patrols|bt:loop] _bt_engine is null — tick skipped`);
			}
		} else {
			// bt_paused is on — only log if debug enabled to avoid spam
			if (game.settings.get(MODULE_ID, "bt_debug")) console.log(`[dc-npc-patrols|bt:loop] bt_paused is true — tick skipped`);
		}
		// Re-render path lines for selected tokens so they stay in sync as NPCs move
		if (_path_debug) _path_debug.render_paths();
	}, interval_ms);
}

// --- Scene control button ---
function register_scene_control() {
	Hooks.on("getSceneControlButtons", (controls) => {
		if (!game.user.isGM) return;

		controls[MODULE_ID] = {
			name: MODULE_ID,
			title: game.i18n.localize("dc-npc-patrols.hub.title"),
			icon: "fa-solid fa-route",
			visible: true,
			order: 98,
			tools: {
				openHub: {
					name: "openHub",
					order: 0,
					title: game.i18n.localize("dc-npc-patrols.controls.hub.tooltip"),
					icon: "fa-solid fa-route",
					button: true,
					onChange: (event, active) => {
						if (!active) return;
						try {
							open_panel();
						} catch (err) {
							console.error("dc-npc-patrols | Error opening patrol hub:", err);
						}
					},
				},
			},
		};
	});
}

function open_panel() {
	if (!_panel) {
		_panel = new PatrolHub();
	}
	_panel.render(true);
	return _panel;
}

function open_hub_for_actor(actor_id, options = {}) {
	const hub = open_panel();
	if (hub?.focus_actor) {
		hub.focus_actor(actor_id, options);
		hub.render({ force: true });
	}
	return hub;
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
	Handlebars.registerHelper("eq", (a, b) => a === b);
	Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
}

Hooks.once("init", () => {
	register_settings();
	register_helpers();
	register_scene_control();
	register_dialog_behaviors();
});

async function _preload_partials() {
	const partials = [
		["attachment-editor", "templates/attachment-editor.hbs"],
		["hub-sidebar", "templates/partials/hub-sidebar.hbs"],
		["scene-view", "templates/partials/scene-view.hbs"],
		["npc-detail", "templates/partials/npc-detail.hbs"],
		["editor-shell", "templates/partials/editor-shell.hbs"],
		["bt-asset-panel", "templates/partials/bt-asset-panel.hbs"],
		["bt-structure-panel", "templates/partials/bt-structure-panel.hbs"],
		["bt-detail-panel", "templates/partials/bt-detail-panel.hbs"],
		["dialog-asset-panel", "templates/partials/dialog-asset-panel.hbs"],
		["dialog-structure-panel", "templates/partials/dialog-structure-panel.hbs"],
		["dialog-detail-panel", "templates/partials/dialog-detail-panel.hbs"],
		["ambient-asset-panel", "templates/partials/ambient-asset-panel.hbs"],
		["ambient-detail-panel", "templates/partials/ambient-detail-panel.hbs"],
		["dialog-editor", "templates/dialog-editor.hbs"],
		["ambient-editor", "templates/ambient-editor.hbs"],
		["bt-editor", "templates/bt-editor.hbs"],
		["behaviour-tab", "templates/actor/behaviour-tab.hbs"],
		["bt-variables-fields", "templates/partials/bt-variables-fields.hbs"],
	];

	for (const [name, path] of partials) {
		try {
			const tpl = await foundry.applications.handlebars.getTemplate(`modules/dc-npc-patrols/${path}`);
			Handlebars.registerPartial(name, tpl);
		} catch (err) {
			console.warn(`[${MODULE_ID}] Failed to preload ${name} partial:`, err);
		}
	}
}

Hooks.once("dcReady", async () => {
	// Apply chat bubble scale on load
	apply_bubble_scale();

	// Preload partials
	await _preload_partials();

	// Initialize subsystems
	const region_manager = new RegionManager(MODULE_ID);

	// Initialize pathfinding and BT engine
	_pathfinding = new Pathfinding();
	_path_debug = new PathDebugOverlay(_pathfinding);
	_bt_engine = new BTEngine(MODULE_ID, {
		region_manager,
		pathfinding: _pathfinding,
	});
	_path_debug.set_bt_engine(_bt_engine);

	// Register all core BT nodes and variable types.
	init_bt_nodes();

	console.log(`[dc-npc-patrols|bt] init complete — engine=${_bt_engine ? "ready" : "null"} pathfinding=${_pathfinding ? "ready" : "null"}`);

	// Register combat flow steps so the BT engine can hook into the pipeline.
	register_combat_flows();

	// Seed default BT templates if no BTs exist
	const existing_bts = game.settings.get(MODULE_ID, "behaviour_trees") || {};
	if (Object.keys(existing_bts).length === 0) {
		const defaults = get_default_bts();
		await game.settings.set(MODULE_ID, "behaviour_trees", defaults);
	}

	// Expose module API
	const mod = game.modules.get(MODULE_ID);
	mod.api = {
		bt_engine: _bt_engine,
		pathfinding: _pathfinding,
		region_manager,
		open_panel,
		open_hub_for_actor,
		close_panel,
		get_hub: () => _panel,
		run_combat_turn: (entry) => _bt_engine?.run_turn(entry),
		// BT node + variable type registration (for external modules)
		register_node,
		register_variable_type,
		init_bt_nodes,
	};

	Hooks.on("dc.combat.npc_turn_start", async (entry) => {
		await _bt_engine?.run_turn(entry);
	});

	Hooks.on("dc.combat.turn_advance", () => {
		clear_active_combat_turn();
		_bt_engine?.reset_all_action_movement();
	});

	Hooks.on("dc.trigger.round_start", async () => {
		if (!game.user.isGM) return;
		_bt_engine?.reset_all_round_movement();
		await _bt_engine?.clear_scene_running_flags();
	});

	if (game.dc?.register_actor_tab) {
		game.dc.register_actor_tab(`${MODULE_ID}.behaviour`, {
			id: "patrol_behaviour",
			label: "dc-npc-patrols.sheet.tab_behaviour",
			template: "behaviour-tab",
			order: 50,
			types: ["npc", "critter", "abomination"],
			gm_only: true,
			visible: (actor) => !!actor.getFlag(MODULE_ID, "bt_id"),
			prepare: prepare_behaviour_tab_context,
			on_render: wire_behaviour_tab_events,
		});
	}
	// Also on window for easy access
	window.dcNpcPatrols = mod.api;
	window.dcNpcPatrols.path_debug = _path_debug;

	// Start independent BT tick loop
	start_bt_tick();

	// --- Region lifecycle hooks (Phase 3) ---
	// Regions are attached to tokens via attachment.token, so Foundry
	// auto-moves them. No updateToken hook needed.

	// Sync regions on scene load (create missing, reposition moved)
	Hooks.on("canvasReady", () => {
		if (!game.user.isGM) return;
		region_manager.sync_all_regions(canvas.scene);
		_pathfinding.invalidate(canvas.scene.id);
		if (_path_debug) {
			_path_debug.clear_paths();
			if (_path_debug._active) _path_debug._render_struct();
		}
	});

	// Clean up regions when a token is deleted
	Hooks.on("deleteToken", (token_doc) => {
		if (!game.user.isGM) return;
		region_manager.cleanup_for_deleted_token(token_doc.parent, token_doc);
		if (token_doc) _bt_engine.remove_blackboard(token_doc.id);
	});

	// --- Pathfinding cache invalidation: token movement ---
	// Tokens are treated as dynamic obstacles. Only the path cache needs
	// invalidation (the wall grid is unaffected). Grid token-occupancy is
	// computed at query time, not cached.
	Hooks.on("createToken", (token_doc) => {
		_pathfinding.invalidate_paths(token_doc.parent.id);
	});
	Hooks.on("deleteToken", (token_doc) => {
		_pathfinding.invalidate_paths(token_doc.parent.id);
	});
	Hooks.on("updateToken", (token_doc, change) => {
		// Only invalidate when position/size/visibility/elevation changes
		const keys = Object.keys(change);
		const relevant = keys.some(k =>
			["x", "y", "width", "height", "hidden", "elevation", "level"].includes(k)
		);
		if (relevant) _pathfinding.invalidate_paths(token_doc.parent.id);
	});

	// --- Pathfinding cache invalidation hooks (Phase 4b) ---
	// Wall/region changes only affect the structural overlay.  Path lines for
	// selected tokens update on BT tick and token selection changes.
	Hooks.on("controlToken", () => {
		if (_path_debug) _path_debug.render_paths();
	});
	Hooks.on("createWall", (wall) => {
		_pathfinding.invalidate(wall.parent.id);
		if (_path_debug?._active) _path_debug._render_struct();
	});
	Hooks.on("updateWall", (wall) => {
		_pathfinding.invalidate(wall.parent.id);
		if (_path_debug?._active) _path_debug._render_struct();
	});
	Hooks.on("deleteWall", (wall) => {
		_pathfinding.invalidate(wall.parent.id);
		if (_path_debug?._active) _path_debug._render_struct();
	});
	Hooks.on("createRegion", (region) => {
		_pathfinding.invalidate(region.parent.id);
		if (_path_debug?._active) _path_debug._render_struct();
	});
	Hooks.on("updateRegion", (region) => {
		_pathfinding.invalidate(region.parent.id);
		if (_path_debug?._active) _path_debug._render_struct();
	});
	Hooks.on("deleteRegion", (region) => {
		_pathfinding.invalidate(region.parent.id);
		if (_path_debug?._active) _path_debug._render_struct();
	});

	// --- Keyboard shortcut: Alt+Shift+P toggles path debug overlay ---
	Hooks.on("keydown", (event) => {
		if (event.altKey && event.shiftKey && (event.key === 'P' || event.key === 'p')) {
			if (_path_debug) {
				_path_debug.toggle();
				event.preventDefault();
			}
		}
	});

	// Expose editors for the scene control tools
	mod.api.dialog_editor = () => new DialogEditor().render(true);
	mod.api.ambient_editor = () => new AmbientEditor().render(true);
	mod.api.bt_editor = () => new BTEditor().render(true);
});
