/**
 * dialog_behaviors.js — Region behavior types for dialog trees and
 * ambient line sets.
 *
 *   dcDialogTree — fires on TOKEN_ENTER, opens the conversation UI
 *   dcAmbient    — fires on TOKEN_ENTER, whispers a random flavour line
 *
 * Both behaviors store tree_id/set_id and actor_id in their system data.
 * Registration happens during init (called from main.js) so the types
 * appear in CONFIG before any region config sheet renders.
 */

const { RegionBehaviorType } = foundry.data.regionBehaviors;
const { REGION_EVENTS } = CONST;
const MODULE_ID = "dc-npc-patrols";

// Static imports for event handler dependencies
import { get_tree, get_ambient_set } from "./dialog_tree_store.js";
import { open_conversation } from "./dialog_runner.js";
import { find_dialog_attachment, find_ambient_attachment, is_in_time_window } from "./attachment_editor.js";

/**
 * dcDialogTree behavior — opens conversation UI when a player token enters.
 */
class DCDialogTreeBehaviorType extends RegionBehaviorType {
	static defineSchema() {
		const { fields } = foundry.data;
		return {
			tree_id: new fields.StringField({ required: true, label: `${MODULE_ID}.dialog.tree_id` }),
			actor_id: new fields.StringField({ required: true, label: `${MODULE_ID}.dialog.actor_id` }),
		};
	}

	static events = {
		[REGION_EVENTS.TOKEN_ENTER]: _on_dialog_token_enter,
	};

	static LOCALIZATION_PREFIXES = [`${MODULE_ID}.behavior.dcDialogTree`];
}

/**
 * dcAmbient behavior — whispers a random line when a player token enters.
 */
class DCAmbientBehaviorType extends RegionBehaviorType {
	static defineSchema() {
		const { fields } = foundry.data;
		return {
			set_id: new fields.StringField({ required: true, label: `${MODULE_ID}.ambient.set_id` }),
			actor_id: new fields.StringField({ required: true, label: `${MODULE_ID}.ambient.actor_id` }),
		};
	}

	static events = {
		[REGION_EVENTS.TOKEN_ENTER]: _on_ambient_token_enter,
	};

	static LOCALIZATION_PREFIXES = [`${MODULE_ID}.behavior.dcAmbient`];
}

// ── Event handlers ─────────────────────────────────────────────────

async function _on_dialog_token_enter(event) {
	// Only fire for the entering player's own client
	if (event.user.isGM) return;
	if (!event.user.isSelf) return;

	const player_token = event.data?.token;
	if (!player_token) return;
	const player_actor = player_token.actor;
	if (!player_actor || player_actor.type === "npc") return;

	const { tree_id, actor_id } = this;
	if (!tree_id || !actor_id) return;

	// Look up the tree
	const tree = get_tree(tree_id);
	if (!tree) return;

	// Check time gate via attachment
	const npc_actor = game.actors.get(actor_id);
	if (!npc_actor) return;

	const attachment = find_dialog_attachment(npc_actor, tree_id);
	if (attachment) {
		if (!is_in_time_window(attachment.time_start, attachment.time_end)) return;
	}

	// Optionally suppress during combat
	if (game.settings.get(MODULE_ID, "combat_freeze") && game.combat?.active) return;

	// Open conversation
	open_conversation(npc_actor, player_actor, tree);
}

async function _on_ambient_token_enter(event) {
	// Only fire for the entering player's own client
	if (event.user.isGM) return;
	if (!event.user.isSelf) return;

	const player_token = event.data?.token;
	if (!player_token) return;
	const player_actor = player_token.actor;
	if (!player_actor || player_actor.type === "npc") return;

	const { set_id, actor_id } = this;
	if (!set_id || !actor_id) return;

	// Look up the set
	const set = get_ambient_set(set_id);
	if (!set?.lines?.length) return;

	// Check time gate via attachment
	const npc_actor = game.actors.get(actor_id);
	if (!npc_actor) return;

	const attachment = find_ambient_attachment(npc_actor, set_id);
	if (attachment) {
		if (!is_in_time_window(attachment.time_start, attachment.time_end)) return;
	}

	// Check cooldown per player
	const cooldown_key = `ambient_cd_${set_id}`;
	const last = player_actor.getFlag(MODULE_ID, cooldown_key) || 0;
	const cooldown_sec = game.settings.get(MODULE_ID, "ambient_cooldown");
	if (Date.now() - last < cooldown_sec * 1000) return;

	// Pick random line, whisper to player
	const line = set.lines[Math.floor(Math.random() * set.lines.length)];
	const speaker = npc_actor.name || "Unknown";
	ChatMessage.create({
		content: `<div class="dc-ambient-dialog"><strong>${speaker}:</strong> ${line}</div>`,
		whisper: [game.user.id],
	});

	await player_actor.setFlag(MODULE_ID, cooldown_key, Date.now());
}

// ── Registration ───────────────────────────────────────────────────

/**
 * Register the dcDialogTree and dcAmbient region behavior types.
 * Must be called during init (before any region config sheet renders).
 */
export function register_dialog_behaviors() {
	const types = ['dcDialogTree', 'dcAmbient'];

	for (const type_key of types) {
		CONFIG.RegionBehavior.typeLabels[type_key] = `TYPES.RegionBehavior.${type_key}`;
		CONFIG.RegionBehavior.typeHints[type_key] = `TYPES.HINTS.RegionBehavior.${type_key}`;
	}

	CONFIG.RegionBehavior.dataModels.dcDialogTree = DCDialogTreeBehaviorType;
	CONFIG.RegionBehavior.dataModels.dcAmbient = DCAmbientBehaviorType;
	CONFIG.RegionBehavior.typeIcons.dcDialogTree = 'fa-solid fa-comments';
	CONFIG.RegionBehavior.typeIcons.dcAmbient = 'fa-solid fa-comment-dots';
}