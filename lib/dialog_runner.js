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
 */

import { is_in_time_window, get_time_of_day } from "./time_gate.js";
import { make_persist_boon } from "./dialog_boon_persist.js";
import { _evaluate_operator } from "./utils.js";

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

	// Don't open a second conversation for the same player
	const existing = _active_conversations.get(player_actor.id);
	if (existing) {
		existing.close();
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
			width: 480,
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
		this.current_node_id = tree.root_node || "start";
	}

	async _prepareContext(_options) {
		// Check node-level flag conditions on the current node
		const resolved_id = this._resolve_node(this.current_node_id);
		if (resolved_id && resolved_id !== this.current_node_id) {
			this.current_node_id = resolved_id;
		}
		const node = this.tree.nodes?.[this.current_node_id];
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
		const visible_responses = responses.filter((r) =>
			_check_flag_conditions(r.flag_conditions, this.player_actor),
		);

		// Replace placeholders in NPC text
		const npc_text = _replace_placeholders(node.npc_text || "", this.npc_actor, this.player_actor);

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
		const node = this.tree.nodes?.[this.current_node_id];
		const response = node?.responses?.find((r) => r.id === response_id);
		if (!response) return;

		// 1. Set quest flags
		if (response.set_flags) {
			const scope = response.set_flags_scope || "actor";
			if (scope === "posse") {
				await _set_posse_flags(this.player_actor, response.set_flags);
			} else {
				for (const [key, value] of Object.entries(response.set_flags)) {
					await this.player_actor.setFlag(MODULE_ID, `quest_flags.${key}`, value);
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
		if (response.goto && this.tree.nodes?.[response.goto]) {
			const target_id = this._resolve_node(response.goto);
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
	 * Resolve a target node, checking flag_conditions and following
	 * flag_conditions_else_goto if they match. Loop protection via visited set.
	 * @param {string} node_id — initial target node id
	 * @returns {string|null} resolved node id, or null if navigation should abort
	 */
	_resolve_node(node_id) {
		const visited = new Set();
		let current = node_id;
		while (current && this.tree.nodes?.[current] && !visited.has(current)) {
			visited.add(current);
			const node = this.tree.nodes[current];
			if (_check_flag_conditions(node.flag_conditions, this.player_actor)) {
				// Conditions matched — divert to the target node
				const divert = node.flag_conditions_else_goto;
				if (divert && this.tree.nodes?.[divert]) {
					return divert;
				}
				return current;
			}
			// Conditions did not match — stay on this node
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
		//Comment for change.
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
 * Set quest flags on all player members of the actor's posse.
 * Falls back to actor-level if the actor has no posse.
 * @param {Actor} actor
 * @param {Object} flags — { key: value }
 */
async function _set_posse_flags(actor, flags) {
	const posse = game.dc.posse?.get_posse_for_actor(actor);
	if (!posse) {
		// No posse — fall back to actor-level
		for (const [key, value] of Object.entries(flags)) {
			await actor.setFlag(MODULE_ID, `quest_flags.${key}`, value);
		}
		return;
	}
	const members = game.dc.posse.get_player_members(posse.id);
	for (const member of members) {
		for (const [key, value] of Object.entries(flags)) {
			await member.setFlag(MODULE_ID, `posse_quest_flags.${key}`, value);
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
function _check_flag_conditions(conditions, actor) {
	if (!conditions || !conditions.length) return true;
	const actor_flags = actor?.getFlag?.(MODULE_ID, "quest_flags") || {};
	const posse_flags = actor?.getFlag?.(MODULE_ID, "posse_quest_flags") || {};
	for (const cond of conditions) {
		if (!cond.flag_key) continue;
		const scope = cond.scope || "actor";
		const flag_store = scope === "posse" ? posse_flags : actor_flags;
		const actual = flag_store[cond.flag_key];
		if (!_evaluate_operator(actual, cond.operator || "exists", cond.expected_value)) {
			return false;
		}
	}
	return true;
}

/**
 * Replace {npc_name}, {player_name}, {time_of_day}, {weekday} placeholders.
 */
function _replace_placeholders(text, npc_actor, player_actor) {
	if (!text) return "";
	const date = game.dc.utils.time.get_date();
	return text
		.replace(/\{npc_name\}/g, npc_actor?.name || "")
		.replace(/\{player_name\}/g, player_actor?.name || "")
		.replace(/\{time_of_day\}/g, get_time_of_day())
		.replace(/\{weekday\}/g, date?.weekday || "");
}