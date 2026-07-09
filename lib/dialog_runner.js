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
import { get_tree } from "./dialog_tree_store.js";

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

		// Replace placeholders in NPC text
		const npc_text = _replace_placeholders(node.npc_text || "", this.npc_actor, this.player_actor);

		return {
			npc_name: this.npc_actor.name,
			npc_text,
			responses,
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
			for (const [key, value] of Object.entries(response.set_flags)) {
				await this.player_actor.setFlag(MODULE_ID, `quest_flags.${key}`, value);
			}
		}

		// 2. Mark as seen (for once-only tracking)
		if (response.once) {
			await this._mark_seen(this.tree.id, response.id);
		}

		// 3. Fire boons
		if (response.boons?.length) {
			await this._fire_boons(response.boons);
		}

		// 4. Navigate or close
		if (response.goto && this.tree.nodes?.[response.goto]) {
			this.current_node_id = response.goto;
			await this._mark_seen(this.tree.id, response.goto);
			this.render({ force: true });
		} else {
			this.close();
		}
	}

	async _fire_boons(boons) {
		const context = game.dc.trigger_manager.create_context("dialog", {
			actor: this.player_actor,
			target: this.npc_actor,
		});

		for (const boon of boons) {
			game.dc.boon_manager.handleBoon(boon, context);
		}

		// Resolve accumulated effects (damage, healing, statuses, updates)
		await game.dc.resolve_context(this.player_actor, context);

		// Process pending roll gates (async: dice + fate chip dialog)
		if (context.pending_roll_gates?.length) {
			await game.dc.trigger_manager.process_pending_roll_gates(this.player_actor, context);
		}
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
 * Replace {npc_name}, {player_name}, {time_of_day}, {weekday} placeholders.
 */
function _replace_placeholders(text, npc_actor, player_actor) {
	if (!text) return "";
	const date = game.dc.utils.get_date();
	return text
		.replace(/\{npc_name\}/g, npc_actor?.name || "")
		.replace(/\{player_name\}/g, player_actor?.name || "")
		.replace(/\{time_of_day\}/g, get_time_of_day())
		.replace(/\{weekday\}/g, date?.weekday || "");
}