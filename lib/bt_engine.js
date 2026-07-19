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
	clear_combat_bt_warnings,
	warn_combat_skip,
} from "./bt_combat_log.js";
import {
	reset_action_movement,
	reset_round_movement,
	clear_actor_running,
} from "./combat_movement.js";
import {
	blackboard_key_for_token,
	find_token_doc,
	get_actor_from_token,
} from "./token_actor.js";
import {
	_to_campaign_components,
	_day_changed,
	_resolve_value,
} from "./utils.js";

export const Status = {
	SUCCESS: "success",
	FAILURE: "failure",
	RUNNING: "running",
};

const COMBAT_TURN_MAX_PASSES = 32;
const COMPOSITE_STATE_PATTERN = /_(seq|sel|par|cooldown|wait)_/;

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
		this._blackboards = new Map();  // token_id → blackboard
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
			const actor = get_actor_from_token(token_doc);
			if (!actor) continue;

			const bb_key = blackboard_key_for_token(token_doc);
			if (!bb_key) continue;

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
			let bb = this._blackboards.get(bb_key);
			if (!bb) {
				bb = this._create_blackboard(token_doc, actor, scene);
				this._blackboards.set(bb_key, bb);
			}

			// Update blackboard with current state
			this._update_blackboard(bb, token_doc, actor, scene, current_unixtime);

			// During combat, only tick the NPC whose turn is active
			if (is_dc_combat_active() && !is_actors_turn(actor.id, token_doc.id)) {
				continue;
			}

			if (is_dc_combat_active() && is_actors_turn(actor.id, token_doc.id)) {
				if (bb.combat_turn_ended) continue;
				await this._tick_combat_tree(tree, bb);
			} else {
				await this._tick_node(tree.root, bb);
			}
		}
	}

	/**
	 * Run one BT tick for an NPC at the start of their combat turn.
	 * @param {object} entry — initiative queue entry
	 */
	async run_turn(entry) {
		if (!game.settings.get(this.module_id, "enable_patrols")) {
			warn_combat_skip(entry?.actor_name, "patrols disabled in module settings");
			return;
		}
		if (!game.user.isGM) return;
		if (game.paused) {
			warn_combat_skip(entry?.actor_name, "game is paused");
			return;
		}
		if (!entry?.token_id) {
			warn_combat_skip(entry?.actor_name, "initiative entry missing token_id");
			return;
		}

		const scene = canvas.scene;
		if (!scene) {
			warn_combat_skip(entry?.actor_name, "no active scene on canvas");
			return;
		}

		const token_doc = find_token_doc(scene, { token_id: entry.token_id });
		if (!token_doc) {
			warn_combat_skip(entry?.actor_name, "token not found on current scene");
			return;
		}

		const actor = get_actor_from_token(token_doc);
		if (!actor) {
			warn_combat_skip(entry?.actor_name, "actor not found");
			return;
		}

		if (!entry.actor_id) entry.actor_id = actor.id;

		const bt_id = actor.getFlag(this.module_id, "bt_id");
		if (!bt_id) {
			warn_combat_skip(actor.name, "no behaviour tree assigned (set bt_id on actor)");
			return;
		}

		const tree = get_bt(bt_id);
		if (!tree?.root) {
			warn_combat_skip(actor.name, `behaviour tree "${bt_id}" missing or empty`);
			return;
		}

		repair_misplaced_child_nodes(tree.root);
		this._ensure_node_ids(tree.root);

		const bb_key = blackboard_key_for_token(token_doc);
		let bb = this._blackboards.get(bb_key);
		if (!bb) {
			bb = this._create_blackboard(token_doc, actor, scene);
			this._blackboards.set(bb_key, bb);
		}

		set_active_combat_turn(entry);
		bb.combat_turn_ended = false;
		clear_combat_bt_warnings(bb);
		this._clear_composite_resume_state(bb);

		const current_unixtime = game.settings.get("Deadlands-Classic", "unixtime");
		this._update_blackboard(bb, token_doc, actor, scene, current_unixtime);
		await reset_action_movement(bb, actor);

		await this._tick_combat_tree(tree, bb);
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
			token_id: token_doc.id,
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

			// Combat turn — cleared by action_end_turn
			combat_turn_ended: false,
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
		bb.is_my_turn = is_actors_turn(bb.actor.id, token_doc.id);
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
		bb.token_id = token_doc.id;
		bb.token = token_doc;
		bb.actor = get_actor_from_token(token_doc) ?? actor;
		bb.scene = scene;
		bb.moving = bb._currently_moving ?? false;
		bb.hidden = token_doc.hidden;
		bb.level_id = token_doc._source.level ?? scene.levels.contents[0]?.id ?? '_default';
		bb.elevation = token_doc.elevation ?? 0;

		// Resolve BT template variables: merge BT defaults with actor-specific values
		const bt_id = bb.actor.getFlag(this.module_id, "bt_id");
		bb.variables = resolve_actor_variables(bb.actor, bt_id);

		// Reset ambient memory on day change
		if (bb.day_changed) bb._ambient_heard = {};
	}

	async _tick_combat_tree(tree, bb) {
		if (bb.combat_turn_ended) return;

		for (let pass = 0; pass < COMBAT_TURN_MAX_PASSES; pass++) {
			const status = await this._tick_node(tree.root, bb);
			if (bb.combat_turn_ended) return;
			if (status === Status.RUNNING) return;
			if (status === Status.FAILURE) return;
			this._clear_composite_resume_state(bb);
		}
	}

	_clear_composite_resume_state(bb) {
		for (const key of Object.keys(bb)) {
			if (COMPOSITE_STATE_PATTERN.test(key)) {
				delete bb[key];
			}
		}
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

	// Remove a blackboard when a token is deleted or leaves the scene
	remove_blackboard(token_id) {
		if (token_id) this._blackboards.delete(token_id);
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