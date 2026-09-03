/**
 * dialog_runner.js — Conversation UI (ApplicationV2).
 *
 * Opens a branching dialog tree as a panel with NPC text + response buttons.
 * When the player selects a response:
 *   1. Quest flags are set on the player actor
 *   2. Boons are fired through the system boon pipeline
 *      (create_context → handleBoon → resolve_context → process_pending_roll_gates)
 *   3. The UI navigates to the next node or closes
 *
 * Once-per-player tracking uses actor flags.
 *
 * Linked fragments are expanded at open time into a flat runtime conversation
 * map; per-actor `{{variable}}` placeholders resolve against the actor's
 * dialog_variables overrides.
 */

import { is_in_time_window, get_time_of_day } from "./time_gate.js";
import { make_persist_boon } from "./dialog_boon_persist.js";
import { _evaluate_operator } from "./utils.js";
import { expand_dialog_tree, resolve_dialog_variables, detect_dialog_cycles } from "./dialog_fragments.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const MODULE_ID = "dc-npc-patrols";

// Track the currently-open conversation per player to avoid duplicates
const _active_conversations = new Map(); // player_id → ConversationPanel

/**
 * Open a conversation between an NPC and a player.
 * @param {Actor} npc_actor
 * @param {Actor} player_actor
 * @param {Object} tree — dialog tree object
 */
export function open_conversation(npc_actor, player_actor, tree) {
	if (!npc_actor || !player_actor || !tree) return;

	// Reject circular fragment references before building the conversation.
	if (tree.id && detect_dialog_cycles(tree.id)) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.dialog.fragment_cycle"));
		return;
	}

	// Don't open a second conversation for the same player. A single token
	// move can fire TOKEN_ENTER multiple times; reopening each time churns the
	// window (close + reopen → flash). If an existing panel is still rendered,
	// keep it; if it was closed (rendered false), clear the stale entry and
	// open a fresh one so the dialog can be reopened after being dismissed.
	const existing = _active_conversations.get(player_actor.id);
	if (existing) {
		if (existing.rendered) return;
		_active_conversations.delete(player_actor.id);
	}

	const panel = new ConversationPanel(npc_actor, player_actor, tree);
	_active_conversations.set(player_actor.id, panel);
	panel.render(true);
}

class ConversationPanel extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "dc-dialog-conversation",
		classes: ["dc-dialog-conversation-app"],
		tag: "div",
		window: {
			title: "dc-npc-patrols.dialog.title",
			icon: "fa-solid fa-comments",
			resizable: false,
		},
		position: {
			width: 720,
			height: "auto",
		},
	};

	static PARTS = {
		main: { template: "modules/dc-npc-patrols/templates/dialog-conversation.hbs" },
	};

	constructor(npc_actor, player_actor, tree) {
		super({});
		this.npc_actor = npc_actor;
		this.player_actor = player_actor;
		this.tree = tree;
		// Expand linked fragments into a flat runtime conversation map.
		this._expanded = expand_dialog_tree(tree) || { nodes: tree.nodes || {}, root_node: tree.root_node };
		this.nodes = this._expanded.nodes;
		this._variables = resolve_dialog_variables(this.npc_actor, tree);
		this.current_node_id = this._expanded.root_node || "start";
	}

	async _prepareContext(_options) {
		// Check node-level flag conditions on the current node
		const resolved_id = this._resolve_node(this.current_node_id);
		if (resolved_id && resolved_id !== this.current_node_id) {
			this.current_node_id = resolved_id;
		}
		const node = this.nodes?.[this.current_node_id];
		if (!node) {
			return {
				npc_name: this.npc_actor.name,
				npc_text: game.i18n.localize("dc-npc-patrols.dialog.node_missing"),
				responses: [],
				portrait: this._get_portrait(),
			};
		}

		// Filter out once-only responses the player has already seen
		const seen = this.player_actor.getFlag(MODULE_ID, "seen_nodes") || {};
		const tree_seen = seen[this.tree.id] || {};
		const responses = (node.responses || []).filter((r) => {
			if (!r.once) return true;
			return !tree_seen[r.id];
		});

		// Filter out responses whose flag conditions don't pass
		let visible_responses = responses.filter((r) =>
			_check_flag_conditions(r.flag_conditions, this.player_actor, this.npc_actor, this._variables),
		);

		// NOTE: knowledge-sharing rows are intentionally NOT hidden when their
		// set_flags resolve empty — an uninformed NPC still offers the row and
		// the write-time parse simply produces no flags (user decision 2026-09-03).
		// Empty set_flags strings on other responses write nothing.

		// Resolve {{variable}} placeholders in NPC text and response text.
		const npc_text = _resolve_text(node.npc_text || "", this._variables, this.npc_actor, this.player_actor);
		for (const r of visible_responses) {
			r.resolved_text = _resolve_text(r.text || "", this._variables, this.npc_actor, this.player_actor);
		}

		return {
			npc_name: this.npc_actor.name,
			npc_text,
			responses: visible_responses,
			portrait: this._get_portrait(),
		};
	}

	_get_portrait() {
		const img = this.npc_actor.img;
		if (img && !img.endsWith("mystery-man.svg") && !img.endsWith("mystery-man.webp")) {
			return img;
		}
		// Try token texture
		const token_tex = this.npc_actor.prototypeToken?.texture?.src;
		if (token_tex) return token_tex;
		return null;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;

		// Response buttons
		html.querySelectorAll("[data-response-id]").forEach((btn) => {
			btn.addEventListener("click", (ev) => {
				const response_id = ev.currentTarget.dataset.responseId;
				this._handle_response(response_id);
			});
		});

		// Exit button
		html.querySelector("[data-action='exit']")?.addEventListener("click", () => {
			this.close();
		});
	}

	async _handle_response(response_id) {
		const node = this.nodes?.[this.current_node_id];
		const response = node?.responses?.find((r) => r.id === response_id);
		if (!response) return;

		// 1. Set quest flags
		if (response.set_flags) {
			const scope = response.set_flags_scope || "actor";
			// set_flags is a plain comma-separated string (see _set_flags_from_text).
			// Entries whose {{variable}} values resolve to "" produce nothing —
			// an uninformed actor writes no flags rather than clobbering set ones.
			const resolved_flags = _set_flags_from_text(response.set_flags, this._variables, this.npc_actor, this.player_actor);
			if (scope === "posse") {
				await _set_posse_flags(this.player_actor, resolved_flags, this.npc_actor);
			} else {
				for (const [key, value] of Object.entries(resolved_flags)) {
					await this.player_actor.setFlag(MODULE_ID, `quest_flags.${_interpolate_flag_key(key, this.npc_actor, this.player_actor)}`, value);
				}
			}
		}

		// 2. Mark as seen (for once-only tracking)
		if (response.once) {
			await this._mark_seen(this.tree.id, response.id);
		}

		// 3. Fire boons
		let keep_open = false;
		const boon_list = Array.isArray(response.boons) ? response.boons : [];
		if (boon_list.length) {
			keep_open = await this._fire_boons(boon_list);
		}

		// 4. Navigate or close (keep open when shop boon fired)
		if (keep_open) return;
		// Fragment terminal: response.goto is null but response._return_to points
		// back to the parent tree node the fragment should return to.
		const nav_target = response.goto || response._return_to;
		if (nav_target && this.nodes?.[nav_target]) {
			const target_id = this._resolve_node(nav_target);
			if (target_id) {
				this.current_node_id = target_id;
				await this._mark_seen(this.tree.id, target_id);
				this.render();
			} else {
				this.close();
			}
		} else {
			this.close();
		}
	}

	/**
	 * Resolve a target node, evaluating its divert list in order.
	 * `node.diverts` is an ordered array of `{ conditions, goto }` entries —
	 * the FIRST entry whose conditions match jumps to `goto` (which is then
	 * resolved in turn, so a divert may target another diverting node).
	 * Loop protection via visited set.
	 * @param {string} node_id — initial target node id
	 * @returns {string|null} resolved node id, or null if navigation should abort
	 */
	_resolve_node(node_id) {
		const visited = new Set();
		let current = node_id;
		while (current && this.nodes?.[current] && !visited.has(current)) {
			visited.add(current);
			const node = this.nodes[current];
			// Ordered divert list: first match wins.
			let divert = null;
			for (const d of node.diverts || []) {
				if (d?.goto && this.nodes?.[d.goto] &&
					_check_flag_conditions(d.conditions, this.player_actor, this.npc_actor, this._variables)) {
					divert = d.goto;
					break;
				}
			}
			if (divert) {
				current = divert;
				continue;
			}
			// No divert matched — render this node
			return current;
		}
		return current;
	}

	async _fire_boons(boons) {
		const boon_list = Array.isArray(boons) ? boons : [];
		const has_open_shop = boon_list.some(b => b.type === "open_shop");

		const context = game.dc.trigger_manager.create_context("dialog", {
			actor: this.player_actor,
			target: this.npc_actor,
			scene: canvas.scene,
			persist_boon: make_persist_boon(this.tree),
		});

		for (const boon of boon_list) {
			if (boon.type === "open_shop" && !game.modules.get("dc-s-n-r")?.active) {
				ui.notifications.warn("Open Shop boon requires the dc-s-n-r module.");
				continue;
			}
			game.dc.boon_manager.handleBoon(boon, context);
		}

		// Resolve accumulated effects (damage, healing, statuses, updates)
		await game.dc.resolve_context.resolve_context(this.player_actor, context);

		// Process pending roll gates (async: dice + fate chip dialog)
		if (context.pending_roll_gates?.length) {
			await game.dc.trigger_manager.process_pending_roll_gates(this.player_actor, context);
		}

		return has_open_shop;
	}

	async _mark_seen(tree_id, node_or_response_id) {
		const seen = foundry.utils.duplicate(this.player_actor.getFlag(MODULE_ID, "seen_nodes") || {});
		if (!seen[tree_id]) seen[tree_id] = {};
		seen[tree_id][node_or_response_id] = true;
		await this.player_actor.setFlag(MODULE_ID, "seen_nodes", seen);
	}

	_close(options) {
		_active_conversations.delete(this.player_actor.id);
		return super._close(options);
	}
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Interpolate placeholders in quest-flag KEY names (both condition keys and
 * set_flags keys) against the conversation context. Lets a shared dialog tree
 * write per-NPC met flags (e.g. `drift_met_{npc_name}` → `drift_met_agnes`).
 * Uses the SAME placeholder set and formatting as prose (`_replace_placeholders`)
 * so `Agnes Harrison` slugs to `agnes_harrison` in a flag key while remaining
 * `Agnes Harrison` in spoken text: placeholders in keys are lowercased and
 * non-alphanumeric runs collapse to `_`.
 * Keys without placeholders pass through unchanged.
 * @param {string} key
 * @param {Actor} npc_actor
 * @param {Actor} player_actor
 * @returns {string}
 */
function _interpolate_flag_key(key, npc_actor, player_actor) {
	if (!key || !key.includes("{")) return key;
	// Reuse prose placeholder values, but slugified for key usage.
	const date = game.dc?.utils?.time?.get_date?.() ?? null;
	const values = {
		npc_name: npc_actor?.name ?? "",
		player_name: player_actor?.name ?? "",
		time_of_day: get_time_of_day(),
		weekday: LONG_DOW[date?.weekday] ?? date?.weekday ?? "",
	};
	return key.replace(/\{([a-z_]+)\}/g, (match, name) => {
		const raw = values[name];
		if (raw === undefined) return match; // unknown placeholder — leave for later resolution / debugging
		return String(raw)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
	});
}

/**
 * Set quest flags on all player members of the actor's posse.
 * Falls back to actor-level if the actor has no posse.
 * @param {Actor} actor
 * @param {Object} flags — { key: value }
 */
/**
 * Set quest flags on all player members of the actor's posse.
 * Falls back to actor-level if the actor has no posse.
 * @param {Actor} actor
 * @param {Object} flags — { key: value }
 * @param {Actor} npc_actor — the conversation's NPC (for flag-key placeholders)
 */
async function _set_posse_flags(actor, flags, npc_actor = null) {
	const posse = game.dc.posse?.get_posse_for_actor(actor);
	if (!posse) {
		// No posse — fall back to actor-level
		for (const [key, value] of Object.entries(flags)) {
			await actor.setFlag(MODULE_ID, `quest_flags.${_interpolate_flag_key(key, npc_actor, actor)}`, value);
		}
		return;
	}
	const members = game.dc.posse.get_player_members(posse.id);
	for (const member of members) {
		for (const [key, value] of Object.entries(flags)) {
			await member.setFlag(MODULE_ID, `posse_quest_flags.${_interpolate_flag_key(key, npc_actor, actor)}`, value);
		}
	}
}

/**
 * Evaluate an array of flag conditions against an actor's quest flags.
 * All conditions must pass (AND logic). Empty/null array = always pass.
 * Each condition may specify scope: 'actor' (default) or 'posse'.
 * @param {Array<{flag_key: string, operator: string, expected_value: *, scope?: string}>} conditions
 * @param {Actor} actor
 * @returns {boolean}
 */
function _check_flag_conditions(conditions, actor, npc_actor = null, variables = null) {
	if (!conditions || !conditions.length) return true;
	const actor_flags = actor?.getFlag?.(MODULE_ID, "quest_flags") || {};
	const posse_flags = actor?.getFlag?.(MODULE_ID, "posse_quest_flags") || {};
	for (const cond of conditions) {
		if (!cond.flag_key) continue;
		const scope = cond.scope || "actor";
		const flag_store = scope === "posse" ? posse_flags : actor_flags;
		const actual = flag_store[_interpolate_flag_key(cond.flag_key, npc_actor, actor)];
		// expected_value resolves {{dialog_variable}} / prose placeholders
		// against the conversation's variables, matching set_flags resolution.
		const expected = typeof cond.expected_value === "string" && variables && Object.keys(variables).length
			? _resolve_text(cond.expected_value, variables, npc_actor, actor)
			: cond.expected_value;
		if (!_evaluate_operator(actual, cond.operator || "exists", expected)) {
			return false;
		}
	}
	return true;
}

/**
 * Replace {npc_name}, {player_name}, {time_of_day}, {weekday} placeholders.
 * {weekday} renders the full day name ("Thursday"); the system's get_date()
 * returns the compact form ("Thu") for sheet/chat timestamps.
 */
const LONG_DOW = {
	Sun: "Sunday",
	Mon: "Monday",
	Tue: "Tuesday",
	Wed: "Wednesday",
	Thu: "Thursday",
	Fri: "Friday",
	Sat: "Saturday",
};

function _replace_placeholders(text, npc_actor, player_actor) {
	if (!text) return "";
	const date = game.dc.utils.time.get_date();
	return text
		.replace(/\{npc_name\}/g, npc_actor?.name || "")
		.replace(/\{player_name\}/g, player_actor?.name || "")
		.replace(/\{time_of_day\}/g, get_time_of_day())
		.replace(/\{weekday\}/g, LONG_DOW[date?.weekday] ?? date?.weekday ?? "");
}

/**
 * Parse a response's set_flags string into a flags map. Stored format is
 * plain text the GM typed: `flag_a, flag_b=5, {{some_var}}` — comma-separated
 * tokens. Each token:
 *   - `{{dialog_variable}}` placeholders expand against the conversation's
 *     variables FIRST (keys and values alike), so a shared fragment writes
 *     per-NPC flag content; a token that resolves to "" produces nothing
 *     (uninformed actor default).
 *   - `name=value` sets that value; bare `name` sets the boolean true.
 *   - A resolved token list may carry multiple entries ("a=1, b") — each
 *     becomes its own flag.
 * Values are NOT re-split on commas, so flavor text passes through.
 * @param {string} text — the raw set_flags string
 * @param {Object} variables — resolved dialog variables (this._variables)
 * @param {Actor} npc_actor
 * @param {Actor} player_actor
 * @returns {Object} flags — { key: value }
 */
function _set_flags_from_text(text, variables, npc_actor, player_actor) {
	const raw = typeof text === "string" ? text : "";
	const expanded = raw.replace(/\{\{(\w+)\}\}/g, (match, name) =>
		variables && Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name] ?? "") : match);
	const out = {};
	for (const part of expanded.split(",").map((s) => s.trim()).filter(Boolean)) {
		const eq = part.indexOf("=");
		if (eq > 0) {
			const name = part.slice(0, eq).trim();
			const value = part.slice(eq + 1).trim();
			if (name && value !== "") out[name] = value;
		} else {
			out[part] = true;
		}
	}
	return out;
}

/**
 * Resolve text: {{var}} template variables first, then the built-in
 * {npc_name} etc. placeholders.
 */
function _resolve_text(text, variables, npc_actor, player_actor) {
	if (!text) return "";
	let out = text;
	if (variables && Object.keys(variables).length) {
		out = out.replace(/\{\{(\w+)\}\}/g, (match, key) => {
			if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
			const val = variables[key];
			return val !== undefined && val !== null && val !== "" ? String(val) : "";
		});
	}
	return _replace_placeholders(out, npc_actor, player_actor);
}
