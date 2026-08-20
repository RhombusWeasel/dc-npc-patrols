/**
 * bt_engine.js — Behaviour Tree engine.
 *
 * Maintains a per-NPC blackboard and ticks the assigned behaviour tree
 * on each tick. Delegates to registered node handlers.
 *
 * The engine provides animate_to and fire_arrival methods for movement
 * nodes, and delegates pathfinding/region management to dependencies.
 */

import { resolve_actor_variables } from "./bt_variables.js";
import { get_prepared_root } from "./bt_tree_cache.js";
import { get_active_bt_tokens } from "./bt_active_tokens.js";
import { NODE_REGISTRY } from "./nodes/loader.js";
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
	get_remaining_budget_yards,
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
import { bt_debug_enabled, bt_log, bt_group, bt_group_end, bt_perf_begin_tick, bt_perf_end_tick } from "./bt_debug.js";

export const Status = {
	SUCCESS: "success",
	FAILURE: "failure",
	RUNNING: "running",
};

const COMBAT_TURN_MAX_PASSES = 32;
const COMPOSITE_STATE_PATTERN = /_(seq|sel|rseq|rsel|par)_/;

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
		this._tick_counter = 0;
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

		if (is_dc_combat_active()) {
			if (debug) bt_log("tick", "combat active — skipping periodic tick");
			return;
		}

		if (debug) bt_group("tick", `scene=${scene.id}`);

		const current_unixtime = game.dc.get_unixtime();
		const active_tokens = get_active_bt_tokens(scene);

		// Per-tick shared values — computed once, passed to all NPCs.
		const tick_ctx = this._build_tick_ctx(current_unixtime);

		this._tick_counter++;
		this.pathfinding.begin_tick(this._tick_counter, scene);
		bt_perf_begin_tick();

		let ticked = 0;

		try {
			// Tick all active trees concurrently. Each tree only touches its own
			// blackboard and token; the shared per-tick caches (_tick_var_cache,
			// pathfinding occupancy) are keyed idempotently and safe to build from
			// any worker. Serializing these was the dominant cost with many trees:
			// one slow await (path round-trip, movement, timer) stalled every later
			// tree until it resolved. Running them in parallel lets each tree's
			// awaits overlap.
			const tick_promises = [];
			for (const token_doc of active_tokens) {
				const actor = get_actor_from_token(token_doc);
				if (!actor) continue;

				const bb_key = blackboard_key_for_token(token_doc);
				if (!bb_key) { if (debug) bt_log("skip", `no bb_key: ${token_doc.name}`); continue; }

				const bt_id = actor.getFlag(this.module_id, "bt_id");
				if (!bt_id) continue;

				const root = get_prepared_root(bt_id);
				if (!root) {
					if (debug) bt_log("skip", `tree missing/empty: ${actor.name} bt_id=${bt_id}`);
					continue;
				}

				let bb = this._blackboards.get(bb_key);
				if (!bb) {
					bb = this._create_blackboard(token_doc, actor, scene);
					this._blackboards.set(bb_key, bb);
					if (debug) bt_log("bb", `created blackboard for ${actor.name} key=${bb_key}`);
				}

				this._update_blackboard(bb, token_doc, actor, scene, current_unixtime, tick_ctx, bt_id);

				if (debug) bt_log("tick.tree", `ticking ${actor.name} root=${root.type}`);
				tick_promises.push(
					this._tick_node(root, bb).then((status) => {
						if (debug) bt_log("tick.tree", `${actor.name} root → ${status}`);
						ticked++;
						return status;
					})
				);
			}
			await Promise.all(tick_promises);
		} finally {
			this.pathfinding.end_tick();
			bt_perf_end_tick(active_tokens.length, ticked);
			this._clear_tick_var_cache();
		}

		if (debug) {
			bt_log("tick", `done: ticked=${ticked} active=${active_tokens.length}`);
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

		const root = get_prepared_root(bt_id);
		if (!root) {
			warn_combat_skip(actor.name, `behaviour tree "${bt_id}" missing or empty`);
			return;
		}

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

		const current_unixtime = game.dc.get_unixtime();
		const tick_ctx = this._build_tick_ctx(current_unixtime);
		this._update_blackboard(bb, token_doc, actor, scene, current_unixtime, tick_ctx, bt_id);
		await reset_action_movement(bb, actor);

		this._tick_counter++;
		this.pathfinding.begin_tick(this._tick_counter, scene);
		try {
			await this._tick_combat_tree(root, bb);
		} finally {
			this.pathfinding.end_tick();
			this._clear_tick_var_cache();
		}
	}

	/**
	 * Continue an NPC's combat BT after an async combat action resolves.
	 * Called from the combat.advance flow step.
	 * @param {string} token_id
	 */
	async signal_combat_resolved(token_id) {
		const debug = bt_debug_enabled();
		if (!game.user.isGM) return;
		if (!token_id) return;
		if (!is_dc_combat_active()) return;

		const bb = this._blackboards.get(token_id);
		if (!bb || bb.combat_turn_ended) {
			if (debug) bt_log("signal_combat_resolved", `skip token=${token_id} ended=${bb?.combat_turn_ended ?? "no bb"}`);
			return;
		}

		const scene = canvas.scene;
		if (!scene) return;

		const token_doc = find_token_doc(scene, { token_id });
		if (!token_doc) return;

		const actor = get_actor_from_token(token_doc);
		if (!actor || !is_actors_turn(actor.id, token_doc.id)) return;

		const bt_id = actor.getFlag(this.module_id, "bt_id");
		if (!bt_id) return;

		const root = get_prepared_root(bt_id);
		if (!root) return;

		const current_unixtime = game.dc.get_unixtime();
		const tick_ctx = this._build_tick_ctx(current_unixtime);
		this._update_blackboard(bb, token_doc, actor, scene, current_unixtime, tick_ctx, bt_id);

		if (debug) bt_log("signal_combat_resolved", `continuing ${actor.name}`);

		this._tick_counter++;
		this.pathfinding.begin_tick(this._tick_counter, scene);
		try {
			await this._tick_combat_tree(root, bb);
		} finally {
			this.pathfinding.end_tick();
			this._clear_tick_var_cache();
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

			// Combat movement
			yards_moved_this_round: 0,
			yards_moved_this_action: 0,
			movement_mode: "normal",

			// Combat turn — cleared by action_end_turn
			combat_turn_ended: false,
		};
	}

	/* Build per-tick shared context — values that don't vary per NPC.
	 * Computed once in tick()/run_turn()/signal_combat_resolved() and passed
	 * to _update_blackboard for every NPC, avoiding redundant per-NPC
	 * game.settings.get calls and solar calculations.
	 */
	_build_tick_ctx(unixtime) {
		const comps = _to_campaign_components(unixtime);
		let campaign_darkness = null;
		if (game.dc?.utils?.time?.get_darkness_level) {
			campaign_darkness = game.dc.utils.time.get_darkness_level(
				new Date(unixtime),
				game.dc.get_campaign_lat(),
				game.dc.get_campaign_lng(),
			);
		}
		return { comps, campaign_darkness };
	}

	/* Cache resolved BT template variables per (actor_id, bt_id) within a tick.
	 * The variable defs are already cached by tree hash in bt_var_def_cache.js;
	 * this avoids re-reading the actor's bt_variables flag for the same actor
	 * when multiple blackboards reference it, and short-circuits when the
	 * (actor, bt_id) pair was already resolved earlier in this tick.
	 */
	_resolve_variables_cached(actor, bt_id) {
		if (!this._tick_var_cache) this._tick_var_cache = new Map();
		const key = `${actor?.id ?? "null"}:${bt_id ?? "null"}`;
		let cached = this._tick_var_cache.get(key);
		if (cached) return cached;
		cached = resolve_actor_variables(actor, bt_id);
		this._tick_var_cache.set(key, cached);
		return cached;
	}

	/* Clear the per-tick variable resolution cache — called at the end of each tick. */
	_clear_tick_var_cache() {
		if (this._tick_var_cache) this._tick_var_cache.clear();
	}

	_update_blackboard(bb, token_doc, actor, scene, unixtime, tick_ctx = null, bt_id = null) {
		bb.last_tick_unixtime = bb.current_unixtime ?? unixtime;
		bb.current_unixtime = unixtime;
		bb.day_changed = _day_changed(bb.last_tick_unixtime, unixtime);
		const comps = tick_ctx?.comps ?? _to_campaign_components(unixtime);
		bb.current_minutes = comps.hour * 60 + comps.minute;
		bb.weekday = comps.weekday;
		bb.combat_active = is_dc_combat_active();
		const active_turn = get_active_combat_turn();
		bb.is_my_turn = is_actors_turn(bb.actor.id, token_doc.id);
		bb.initiative_card = bb.is_my_turn ? (active_turn?.card_name ?? null) : null;
		bb.weather = scene.getFlag(this.module_id, "weather") || "clear";
		bb.scene_darkness = scene.environment?.darknessLevel ?? 0;
		bb.campaign_darkness = tick_ctx?.campaign_darkness ?? bb.scene_darkness;
		bb.token_id = token_doc.id;
		bb.token = token_doc;
		bb.actor = get_actor_from_token(token_doc) ?? actor;
		bb.scene = scene;
		bb.moving = bb._currently_moving ?? false;
		bb.hidden = token_doc.hidden;
		bb.level_id = token_doc._source.level ?? scene.levels.contents[0]?.id ?? '_default';
		bb.elevation = token_doc.elevation ?? 0;

		// Resolve BT template variables: merge BT defaults with actor-specific values.
		// bt_id is passed from the caller when already known (avoids redundant getFlag).
		const resolved_bt_id = bt_id ?? bb.actor.getFlag(this.module_id, "bt_id");
		bb.variables = this._resolve_variables_cached(bb.actor, resolved_bt_id);

		// Reset ambient memory on day change
		if (bb.day_changed) bb._ambient_heard = {};
	}

	async _tick_combat_tree(root, bb) {
		if (bb.combat_turn_ended) return;

		const debug = bt_debug_enabled();

		for (let pass = 0; pass < COMBAT_TURN_MAX_PASSES; pass++) {
			if (debug) bt_log("combat.pass", `pass=${pass} ${bb.actor?.name}`);
			const status = await this._tick_node(root, bb);
			if (debug) bt_log("combat.pass", `pass=${pass} root → ${status} ended=${bb.combat_turn_ended}`);
			if (bb.combat_turn_ended) return;
			if (status === Status.RUNNING) {
				// A movement node returned RUNNING — it planned a path and moved
				// one step. If there are still steps left and budget remaining,
				// continue the pass loop so the NPC walks the full path within
				// this turn. Without this, movement-only turns (no fire_weapon or
				// other combat action dispatched through the pipeline) would
				// freeze after one step because signal_combat_resolved() never
				// fires to re-tick the BT.
				if (this._has_walkable_move_path(bb)) {
					if (debug) bt_log("combat.pass", `pass=${pass} RUNNING with walkable path — continuing`);
					continue;
				}
				return;
			}
			if (status === Status.FAILURE) return;
			this._clear_composite_resume_state(bb);
		}

		if (debug) bt_log("combat.pass", `hit max passes (${COMBAT_TURN_MAX_PASSES})`);
	}

	/**
	 * Check if the blackboard has an active move path with remaining steps
	 * and remaining movement budget. Used by _tick_combat_tree to decide
	 * whether to continue the pass loop when the root returns RUNNING.
	 * @param {object} bb
	 * @returns {boolean}
	 */
	_has_walkable_move_path(bb) {
		for (const key of Object.keys(bb)) {
			const ms = bb[key];
			if (!ms || !Array.isArray(ms.path) || typeof ms.index !== "number") continue;
			if (ms.index >= ms.path.length) continue;
			const mode = ms.movement_mode || bb.movement_mode || "normal";
			if (get_remaining_budget_yards(bb, mode) <= 0) continue;
			return true;
		}
		return false;
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
		// Handlers can declare `no_resolve: ['field_name']` to exclude fields
		// that hold literal values (e.g. variable_key) which must not be
		// template-resolved.
		//
		// Optimization: only shallow-clone + iterate fields when the node
		// ACTUALLY contains {{ placeholders. When variables are defined but
		// this node has no placeholders, we skip the clone entirely — avoiding
		// per-node allocation + field iteration overhead during tree traversal.
		let tick_node = node;
		const vars = bb.variables || {};
		const skip_fields = new Set(['_id', 'type', 'children', 'child', ...(handler.no_resolve || [])]);
		let needs_resolve = false;
		if (Object.keys(vars).length > 0) {
			// Vars exist — check if THIS node has any {{ in its string fields.
			for (const [k, v] of Object.entries(node)) {
				if (!skip_fields.has(k) && typeof v === 'string' && v.includes('{{')) {
					needs_resolve = true;
					break;
				}
			}
		} else {
			// No vars — only resolve if node has raw {{ (unlikely but safe).
			for (const [k, v] of Object.entries(node)) {
				if (!skip_fields.has(k) && typeof v === 'string' && v.includes('{{')) {
					needs_resolve = true;
					break;
				}
			}
		}
		if (needs_resolve) {
			tick_node = { ...node };
			for (const [k, v] of Object.entries(node)) {
				if (skip_fields.has(k)) continue;
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