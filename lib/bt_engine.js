/**
 * bt_engine.js — Behaviour Tree engine.
 *
 * Maintains a per-NPC blackboard and ticks the assigned behaviour tree
 * on each time poll. Delegates to registered node handlers.
 *
 * The engine calls into existing movement code (animate_to, cross_scene,
 * fire_arrival, region_manager) which are refactored from PatrolEngine
 * and passed in as constructor dependencies.
 */

import { get_bt } from "./bt_store.js";
import { NODE_REGISTRY } from "./bt_nodes.js";
import { repair_misplaced_child_nodes } from "./bt_tree_repair.js";
import { resolve_actor_variables } from "./bt_variables.js";
import {
	is_dc_combat_active,
	is_actors_turn,
	set_active_combat_turn,
	get_active_combat_turn,
} from "./combat_turn.js";
import {
	reset_action_movement,
	reset_round_movement,
	clear_actor_running,
} from "./combat_movement.js";
import {
	_to_campaign_components,
	_unix_to_minutes,
	_day_changed,
	_resolve_value,
	_has_unresolved_variables,
} from "./utils.js";

export const Status = {
	SUCCESS: "success",
	FAILURE: "failure",
	RUNNING: "running",
};

export class BTEngine {
	/**
	 * @param {string} module_id
	 * @param {object} deps — { cross_scene, region_manager, pathfinding, animate_to, fire_arrival }
	 */
	constructor(module_id, deps) {
		this.module_id = module_id;
		this.cross_scene = deps.cross_scene;
		this.region_manager = deps.region_manager;
		this.pathfinding = deps.pathfinding;
		this.animate_to = deps.animate_to;       // async (token_doc, wp) => void
		this.fire_arrival = deps.fire_arrival;   // async (token_doc, actor, wp) => void
		this._blackboards = new Map();  // actor_id → blackboard
	}

	// Called on independent BT tick interval (every 2s, regardless of game time)
	async tick() {
		if (!game.settings.get(this.module_id, "enable_patrols")) return;
		if (!game.user.isGM) return;
		if (game.paused) return;

		const scene = canvas.scene;
		if (!scene) return;

		const current_unixtime = game.settings.get("Deadlands-Classic", "unixtime");

		for (const token_doc of scene.tokens) {
			const actor = token_doc.actor;
			if (!actor) continue;

			// Get the assigned BT
			const bt_id = actor.getFlag(this.module_id, "bt_id");
			if (!bt_id) continue;

			const tree = get_bt(bt_id);
			if (!tree?.root) {
				continue;
			}

			repair_misplaced_child_nodes(tree.root);

			// Ensure all nodes have _id (needed for multi-tick state keys)
			this._ensure_node_ids(tree.root);

			// Get or create blackboard
			let bb = this._blackboards.get(actor.id);
			if (!bb) {
				bb = this._create_blackboard(token_doc, actor, scene);
				this._blackboards.set(actor.id, bb);
			}

			// Update blackboard with current state
			this._update_blackboard(bb, token_doc, actor, scene, current_unixtime);

			// During combat, only tick the NPC whose turn is active
			if (is_dc_combat_active() && !is_actors_turn(actor.id, token_doc.id)) {
				continue;
			}

			// Tick the tree
			await this._tick_node(tree.root, bb);
		}
	}

	/**
	 * Run one BT tick for an NPC at the start of their combat turn.
	 * @param {object} entry — initiative queue entry
	 */
	async run_turn(entry) {
		if (!game.settings.get(this.module_id, "enable_patrols")) return;
		if (!game.user.isGM) return;
		if (game.paused) return;
		if (!entry?.actor_id) return;

		const actor = game.dc?.combat_actor?.resolve_entry_actor(entry)
			?? game.actors.get(entry.actor_id);
		if (!actor) return;

		const bt_id = actor.getFlag(this.module_id, "bt_id");
		if (!bt_id) return;

		const tree = get_bt(bt_id);
		if (!tree?.root) return;

		const scene = canvas.scene;
		if (!scene) return;

		let token_doc = entry.token_id ? scene.tokens.get(entry.token_id) : null;
		if (!token_doc) {
			token_doc = scene.tokens.find((t) => t.actor?.id === actor.id);
		}
		if (!token_doc) return;

		repair_misplaced_child_nodes(tree.root);
		this._ensure_node_ids(tree.root);

		let bb = this._blackboards.get(actor.id);
		if (!bb) {
			bb = this._create_blackboard(token_doc, actor, scene);
			this._blackboards.set(actor.id, bb);
		}

		set_active_combat_turn(entry);

		const current_unixtime = game.settings.get("Deadlands-Classic", "unixtime");
		this._update_blackboard(bb, token_doc, actor, scene, current_unixtime);
		await reset_action_movement(bb, actor);

		await this._tick_node(tree.root, bb);
	}

	_create_blackboard(token_doc, actor, scene) {
		return {
			// Time state
			last_tick_unixtime: null,
			current_unixtime: null,
			current_minutes: 0,
			weekday: 0,
			day_changed: false,

			// World state
			combat_active: false,
			is_my_turn: false,
			initiative_card: null,
			weather: "clear",
			scene_darkness: 0,
			campaign_darkness: 0,

			// Token state
			token: token_doc,
			actor,
			scene,
			moving: false,
			current_waypoint: null,
			hidden: false,
			level_id: token_doc._source.level ?? scene.levels.contents[0]?.id ?? '_default',
			elevation: token_doc.elevation ?? 0,

			// Node state
			sleep_state: 'awake',

			// Combat movement
			yards_moved_this_round: 0,
			yards_moved_this_action: 0,
			movement_mode: "normal",
		};
	}

	_update_blackboard(bb, token_doc, actor, scene, unixtime) {
		bb.last_tick_unixtime = bb.current_unixtime ?? unixtime;
		bb.current_unixtime = unixtime;
		bb.day_changed = _day_changed(bb.last_tick_unixtime, unixtime);
		const comps = _to_campaign_components(unixtime);
		bb.current_minutes = comps.hour * 60 + comps.minute;
		bb.weekday = comps.weekday;
		bb.combat_active = is_dc_combat_active();
		const active_turn = get_active_combat_turn();
		bb.is_my_turn = is_actors_turn(actor.id, token_doc.id);
		bb.initiative_card = bb.is_my_turn ? (active_turn?.card_name ?? null) : null;
		bb.weather = scene.getFlag(this.module_id, "weather") || "clear";
		bb.scene_darkness = scene.environment?.darknessLevel ?? 0;
		if (game.dc?.utils?.time?.get_darkness_level) {
			bb.campaign_darkness = game.dc.utils.time.get_darkness_level(
				new Date(unixtime),
				game.settings.get("Deadlands-Classic", "campaign_lat"),
				game.settings.get("Deadlands-Classic", "campaign_lng"),
			);
		} else {
			bb.campaign_darkness = bb.scene_darkness;
		}
		bb.token = token_doc;
		bb.actor = actor;
		bb.scene = scene;
		bb.moving = bb._currently_moving ?? false;
		bb.hidden = token_doc.hidden;
		bb.level_id = token_doc._source.level ?? scene.levels.contents[0]?.id ?? '_default';
		bb.elevation = token_doc.elevation ?? 0;

		// Resolve BT template variables: merge BT defaults with actor-specific values
		const bt_id = actor.getFlag(this.module_id, "bt_id");
		bb.variables = resolve_actor_variables(actor, bt_id);

		// Reset ambient memory on day change
		if (bb.day_changed) bb._ambient_heard = {};
	}

	async _tick_node(node, bb) {
		if (!node?.type) return Status.FAILURE;

		const handler = NODE_REGISTRY[node.type];
		if (!handler) return Status.FAILURE;

		// Resolve {{var}} placeholders in node fields before ticking.
		let tick_node = node;
		const vars = bb.variables || {};
		const needs_resolve = Object.keys(vars).length > 0
			|| Object.entries(node).some(([k, v]) =>
				!['_id', 'type', 'children', 'child'].includes(k)
				&& typeof v === 'string' && v.includes('{{'));
		if (needs_resolve) {
			tick_node = { ...node };
			for (const [k, v] of Object.entries(node)) {
				if (k === '_id' || k === 'type' || k === 'children' || k === 'child') continue;
				tick_node[k] = _resolve_value(v, vars);
			}
		}

		return handler.tick(tick_node, bb, this);
	}

	// Remove a blackboard when an NPC is deleted or leaves the scene
	remove_blackboard(actor_id) {
		this._blackboards.delete(actor_id);
	}

	reset_all_round_movement() {
		for (const bb of this._blackboards.values()) {
			reset_round_movement(bb);
		}
	}

	async reset_all_action_movement() {
		for (const bb of this._blackboards.values()) {
			await reset_action_movement(bb, bb.actor);
		}
	}

	async clear_scene_running_flags() {
		if (!canvas?.scene) return;
		for (const token_doc of canvas.scene.tokens) {
			if (token_doc.actor) await clear_actor_running(token_doc.actor);
		}
	}

	// Ensure all nodes in a tree have _id (needed for multi-tick state keys).
	// Use deterministic path-based ids so sequence/selector resume state survives
	// across ticks even when the stored tree has no editor-assigned _id fields.
	_ensure_node_ids(node, path = "r") {
		if (!node?._id) node._id = path;
		const def = NODE_REGISTRY[node.type];
		if (node.children) {
			for (let i = 0; i < node.children.length; i++) {
				this._ensure_node_ids(node.children[i], `${path}.${i}`);
			}
		}
		if (node.child && def?.category === "decorator") {
			this._ensure_node_ids(node.child, `${path}.c`);
		}
	}
}