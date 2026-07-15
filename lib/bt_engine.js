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
import {
	_to_campaign_components,
	_unix_to_minutes,
	_day_changed,
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
				console.warn(`[dc-npc-patrols] BT "${bt_id}" assigned to "${actor.name}" but not found in store.`);
				continue;
			}

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

			// Tick the tree
			const root_status = await this._tick_node(tree.root, bb);
			console.log(`[dc-npc-patrols] BT tick for "${actor.name}": root=${root_status}, token_pos=(${bb.token.x}, ${bb.token.y}), level=${bb.level_id}`);
		}
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
			weather: "clear",

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
		};
	}

	_update_blackboard(bb, token_doc, actor, scene, unixtime) {
		bb.last_tick_unixtime = bb.current_unixtime ?? unixtime;
		bb.current_unixtime = unixtime;
		bb.day_changed = _day_changed(bb.last_tick_unixtime, unixtime);
		const comps = _to_campaign_components(unixtime);
		bb.current_minutes = comps.hour * 60 + comps.minute;
		bb.weekday = comps.weekday;
		bb.combat_active = game.combat?.active ?? false;
		bb.weather = scene.getFlag(this.module_id, "weather") || "clear";
		bb.token = token_doc;
		bb.actor = actor;
		bb.scene = scene;
		bb.moving = bb._currently_moving ?? false;
		bb.hidden = token_doc.hidden;
		bb.level_id = token_doc._source.level ?? scene.levels.contents[0]?.id ?? '_default';
		bb.elevation = token_doc.elevation ?? 0;
		// Reset ambient memory on day change
		if (bb.day_changed) bb._ambient_heard = {};
	}

	async _tick_node(node, bb) {
		const handler = NODE_REGISTRY[node.type];
		if (!handler) {
			console.warn(`dc-npc-patrols | Unknown BT node type: ${node.type}`);
			return Status.FAILURE;
		}
		return handler.tick(node, bb, this);
	}

	// Remove a blackboard when an NPC is deleted or leaves the scene
	remove_blackboard(actor_id) {
		this._blackboards.delete(actor_id);
	}

	// Ensure all nodes in a tree have _id (needed for multi-tick state)
	_ensure_node_ids(node, counter = { n: 0 }) {
		if (!node._id) node._id = `auto_${++counter.n}_${Date.now().toString(36).slice(-4)}`;
		if (node.children) for (const c of node.children) this._ensure_node_ids(c, counter);
		if (node.child) this._ensure_node_ids(node.child, counter);
	}
}