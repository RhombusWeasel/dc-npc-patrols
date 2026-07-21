/**
 * bt_engine.js — Behaviour Tree engine.
 *
 * Maintains a per-NPC blackboard and ticks the assigned behaviour tree
 * on each tick. Delegates to registered node handlers.
 *
 * The engine provides animate_to and fire_arrival methods for movement
 * nodes, and delegates pathfinding/region management to dependencies.
 */

import { get_bt } from "./bt_store.js";
import { NODE_REGISTRY, init_bt_nodes } from "./nodes/loader.js";
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
	_animate_token_travel,
} from "./utils.js";
import { bt_debug_enabled, bt_log, bt_group, bt_group_end } from "./bt_debug.js";

export const Status = {
	SUCCESS: "success",
	FAILURE: "failure",
	RUNNING: "running",
};

const COMBAT_TURN_MAX_PASSES = 32;
const COMPOSITE_STATE_PATTERN = /_(seq|sel|rseq|rsel|par|cooldown|wait)_/;

export class BTEngine {
	/**
	 * @param {string} module_id
	 * @param {object} deps — { region_manager, pathfinding }
	 */
	constructor(module_id, deps) {
		this.module_id = module_id;
		this.region_manager = deps.region_manager;
		this.pathfinding = deps.pathfinding;
		this._blackboards = new Map();  // token_id → blackboard
	}

	/**
	 * Animate a token to a grid-coordinate step {x, y} (grid units, not pixels).
	 * Used by move_steps.js and movement nodes.
	 * @param {TokenDocument} token_doc
	 * @param {{x: number, y: number}} step — grid coordinates
	 */
	async animate_to(token_doc, step) {
		const grid = token_doc.parent.grid.size;
		await _animate_token_travel(token_doc, step.x * grid, step.y * grid);
	}

	/**
	 * Post an arrival chat line if the waypoint has arrival_lines.
	 * @param {TokenDocument} token_doc
	 * @param {Actor} actor
	 * @param {object} wp — waypoint-like object with optional arrival_lines and label
	 */
	async fire_arrival(token_doc, actor, wp) {
		if (!wp?.arrival_lines?.length) return;
		const line = wp.arrival_lines[Math.floor(Math.random() * wp.arrival_lines.length)];
		const name = token_doc.name || actor?.name || "";
		const flavor = game.i18n.format("dc-npc-patrols.panel.arrival_chat_flavor", {
			name,
			label: wp.label || "",
		});
		const message_html = `
			<div class="dc-patrol-arrival">
				<div class="dc-patrol-arrival-flavor">${flavor}</div>
				<div class="dc-patrol-arrival-line"><strong>${name}:</strong> ${line}</div>
			</div>
		`;
		ChatMessage.create({
			user: game.user.id,
			speaker: { alias: name },
			content: message_html,
			style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
		});
	}

	/**
	 * Public accessor for a blackboard by token ID.
	 * @param {string} token_id
	 * @returns {object|null}
	 */
	get_blackboard_for_token(token_id) {
		return this._blackboards.get(token_id) ?? null;
	}

	// Called on independent BT tick interval (every 2s, regardless of game time)
	async tick() {
		const debug = bt_debug_enabled();
		if (!game.settings.get(this.module_id, "enable_patrols")) { if (debug) bt_log("tick", "enable_patrols is off — skipping"); return; }
		if (!game.user.isGM) return;
		if (game.paused) { if (debug) bt_log("tick", "game is paused — skipping"); return; }

		const scene = canvas.scene;
		if (!scene) { if (debug) bt_log("tick", "no active scene on canvas — skipping"); return; }

		if (debug) bt_group("tick", `scene=${scene.id} tokens=${scene.tokens.size}`);

		const current_unixtime = game.settings.get("Deadlands-Classic", "unixtime");

		let ticked = 0;
		let skipped = 0;

		for (const token_doc of scene.tokens) {
			const actor = get_actor_from_token(token_doc);
			if (!actor) { skipped++; continue; }

			const bb_key = blackboard_key_for_token(token_doc);
			if (!bb_key) { if (debug) bt_log("skip", `no bb_key: ${token_doc.name}`); skipped++; continue; }

			// Get the assigned BT
			const bt_id = actor.getFlag(this.module_id, "bt_id");
			if (!bt_id) { if (debug) bt_log("skip", `no bt_id: ${actor.name}`); skipped++; continue; }

			const tree = get_bt(bt_id);
			if (!tree?.root) {
				if (debug) bt_log("skip", `tree missing/empty: ${actor.name} bt_id=${bt_id}`);
				skipped++; continue;
			}

			repair_misplaced_child_nodes(tree.root);

			// Ensure all nodes have _id (needed for multi-tick state keys)
			this._ensure_node_ids(tree.root);

			// Get or create blackboard
			let bb = this._blackboards.get(bb_key);
			if (!bb) {
				bb = this._create_blackboard(token_doc, actor, scene);
				this._blackboards.set(bb_key, bb);
				if (debug) bt_log("bb", `created blackboard for ${actor.name} key=${bb_key}`);
			}

			// Update blackboard with current state
			this._update_blackboard(bb, token_doc, actor, scene, current_unixtime);

			// During combat, only tick the NPC whose turn is active
			if (is_dc_combat_active() && !is_actors_turn(actor.id, token_doc.id)) {
				if (debug) bt_log("skip", `not their turn: ${actor.name} (combat active)`);
				skipped++;
				continue;
			}

			if (is_dc_combat_active() && is_actors_turn(actor.id, token_doc.id)) {
				if (bb.combat_turn_ended) {
					if (debug) bt_log("skip", `combat turn ended: ${actor.name}`);
					skipped++;
					continue;
				}
				if (debug) bt_log("tick.combat", `ticking ${actor.name} (their turn)`);
				await this._tick_combat_tree(tree, bb);
			} else {
				if (debug) bt_log("tick.tree", `ticking ${actor.name} root=${tree.root.type}`);
				const status = await this._tick_node(tree.root, bb);
				if (debug) bt_log("tick.tree", `${actor.name} root → ${status}`);
			}
			ticked++;
		}

		if (debug) {
			bt_log("tick", `done: ticked=${ticked} skipped=${skipped}`);
			bt_group_end();
		}
	}

	/**
	 * Run one BT tick for an NPC at the start of their combat turn.
	 * @param {object} entry — initiative queue entry
	 */
	async run_turn(entry) {
		const debug = bt_debug_enabled();
		if (debug) bt_log("run_turn", `entry=${JSON.stringify(entry)}`);
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

		const debug = bt_debug_enabled();

		for (let pass = 0; pass < COMBAT_TURN_MAX_PASSES; pass++) {
			if (debug) bt_log("combat.pass", `pass=${pass} ${bb.actor?.name}`);
			const status = await this._tick_node(tree.root, bb);
			if (debug) bt_log("combat.pass", `pass=${pass} root → ${status} ended=${bb.combat_turn_ended}`);
			if (bb.combat_turn_ended) return;
			if (status === Status.RUNNING) return;
			if (status === Status.FAILURE) return;
			this._clear_composite_resume_state(bb);
		}

		if (debug) bt_log("combat.pass", `hit max passes (${COMBAT_TURN_MAX_PASSES})`);
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
		if (!handler) {
			if (bt_debug_enabled()) bt_log("node.missing", `type=${node.type} _id=${node._id} — no handler in NODE_REGISTRY`);
			return Status.FAILURE;
		}

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

		const debug = bt_debug_enabled();
		if (debug) bt_log("node", `${node.type} (${node._id})`);

		try {
			const status = await handler.tick(tick_node, bb, this);
			if (debug) bt_log("node.status", `${node.type} (${node._id}) → ${status}`);
			return status;
		} catch (err) {
			console.error(`[dc-npc-patrols|bt:node] ${node.type} (${node._id}) threw:`, err);
			return Status.FAILURE;
		}
	}

	/**
	 * Get the remaining path segments for a token's active move, if any.
	 * Scans the blackboard for any key holding a move-state object
	 * ({ path: [...], index: <n> }) — covers all movement node types
	 * (move_to, move_to_region, wander_region, flee, close_target, etc).
	 * @param {string} token_id
	 * @returns {array|null} — array of {x, y, level_id} or null if no active move
	 */
	get_remaining_path(token_id) {
		const bb = this._blackboards.get(token_id);
		if (!bb) return null;
		for (const key of Object.keys(bb)) {
			const move_state = bb[key];
			if (!move_state || !Array.isArray(move_state.path) || typeof move_state.index !== "number") continue;
			const remaining = move_state.path.slice(move_state.index);
			if (remaining.length > 1) return remaining;
		}
		return null;
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