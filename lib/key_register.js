/**
 * key_register.js — Registers the 'key' gear type with the Deadlands-Classic
 * system via the extension APIs.
 *
 * Keys link to a specific door wall by UUID (copied from the wall's copy-ID
 * button). Players can use the key to unlock the door; NPCs with the key
 * in their gear can path through locked/secret doors.
 *
 * Follows the dc-containers/documents pattern:
 *   - register_gear_type (editor schema, viewer schema, use handler)
 *   - register_gear_partial (player + GM gear tab partials)
 *   - register_gm_tab (GM management tab)
 *   - register_gear_templates (pre-built key templates)
 */

import { register_socket, request_key_unlock } from "./key_socket.js";
import { is_token_adjacent_to_door } from "./doors.js";

const MODULE_ID = "dc-npc-patrols";

// ─── Key data helpers ─────────────────────────────────────────────────────

function key_data_defaults() {
	return {
		wall_uuid: "",
	};
}

function normalize_key_data(data) {
	if (!data) return { ...key_data_defaults() };
	return {
		wall_uuid: String(data.wall_uuid ?? ""),
	};
}

// ─── Use-item handler ─────────────────────────────────────────────────────

/**
 * Called when a player clicks "use" on a key item.
 * Checks if the player's token is adjacent to the door matching wall_uuid,
 * then sends a socket request to the GM to unlock it.
 */
async function use_handler(actor, path, key, item) {
	if (path !== "char.gear.keys") return;
	if (!item) return;

	const key_data = normalize_key_data(item);
	if (!key_data.wall_uuid) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.key.no_door_linked"));
		return;
	}

	// Resolve the wall to get the scene
	const wall = await fromUuid(key_data.wall_uuid);
	if (!wall?.isDoor) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.key.door_not_found"));
		return;
	}

	const scene = wall.parent;
	if (!scene) return;

	// Check if the player's token is adjacent to the door
	// Use the system's pathfinding grid data for approach-cell lookup
	const pathfinding = game.modules.get(MODULE_ID)?.api?.pathfinding;
	if (!pathfinding) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.key.pathfinding_unavailable"));
		return;
	}

	const grid_data = pathfinding.get_grid_data(scene);
	if (!grid_data) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.key.no_grid_data"));
		return;
	}

	// Find the player's token on this scene
	const token_doc = canvas.tokens?.placeables?.find(
		(t) => t.document?.actor?.uuid === actor.uuid
	)?.document;

	if (!token_doc) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.key.no_token_on_scene"));
		return;
	}

	const token_level = token_doc.level ?? "_default";
	const is_adjacent = is_token_adjacent_to_door(
		token_doc, wall, scene, token_level, grid_data
	);

	if (!is_adjacent) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.key.not_adjacent"));
		return;
	}

	// Check if the door is actually locked
	if (wall.ds !== CONST.WALL_DOOR_STATES.LOCKED) {
		ui.notifications.info(game.i18n.localize("dc-npc-patrols.key.already_unlocked"));
		return;
	}

	// Send unlock request to GM
	request_key_unlock(key_data.wall_uuid);
}

// ─── Pre-built key templates ──────────────────────────────────────────────

const key_templates = {
	skeleton_key: {
		label: game.i18n?.localize("dc-npc-patrols.key.template_skeleton") || "Skeleton Key",
		cost: 50,
		quantity: 1,
		weight: 0,
		wall_uuid: "",
		description: "A simple iron key. Link it to a specific door by pasting the wall's UUID.",
		user_made: false,
	},
};

// ─── Schema builders ──────────────────────────────────────────────────────

function build_new_object() {
	return {
		label: "",
		cost: 0,
		quantity: 1,
		weight: 0,
		wall_uuid: "",
		description: "",
		rarity: "common",
		user_made: true,
		boons: [],
	};
}

function build_editor_schema(rarity_options) {
	return {
		new_object: build_new_object(),
		data: {
			name:      { key: "label",     type: "text",      value: "label",     label: game.i18n.localize("dc.shared.name") },
			wall_uuid: { key: "wall_uuid", type: "text",      value: "wall_uuid", label: game.i18n.localize("dc-npc-patrols.key.wall_uuid") },
			value:     { key: "cost",      type: "number",    value: "cost",      label: game.i18n.localize("dc.shared.cost") },
			quantity:  { key: "quantity",  type: "number",    value: "quantity",  label: game.i18n.localize("dc.shared.quantity") },
			weight:    { key: "weight",    type: "number",    value: "weight",    label: game.i18n.localize("dc.shared.weight") },
			rarity:    { key: "rarity",    type: "dropdown",  value: "rarity",    options: rarity_options, translation_path: "dc.equipment.rarity", label: game.i18n.localize("dc.shared.rarity") },
			description: { key: "description", type: "text_area", value: "description", label: game.i18n.localize("dc.shared.description") },
		},
		func: (form_data) => normalize_key_data(form_data),
	};
}

function build_viewer_schema(rarity_options) {
	return {
		new_object: build_new_object(),
		data: {
			name:      { key: "label",     type: "text",      value: "label",     label: game.i18n.localize("dc.shared.name") },
			wall_uuid: { key: "wall_uuid", type: "text",      value: "wall_uuid", label: game.i18n.localize("dc-npc-patrols.key.wall_uuid") },
			value:     { key: "cost",      type: "number",    value: "cost",      label: game.i18n.localize("dc.shared.cost") },
			quantity:  { key: "quantity",  type: "number",    value: "quantity",  label: game.i18n.localize("dc.shared.quantity") },
			weight:    { key: "weight",    type: "number",    value: "weight",    label: game.i18n.localize("dc.shared.weight") },
			rarity:    { key: "rarity",    type: "dropdown",  value: "rarity",    options: rarity_options, translation_path: "dc.equipment.rarity", label: game.i18n.localize("dc.shared.rarity") },
			description: { key: "description", type: "text_area", value: "description", label: game.i18n.localize("dc.shared.description") },
		},
	};
}

// ─── Ensure gear.keys exists on the system ────────────────────────────────

async function _ensure_gear_keys() {
	if (!game.user.isGM || !game.dc?.system?.gear) return;
	if (game.dc.system.gear.keys !== undefined) return;
	game.dc.system.gear.keys = {};
	if (game.dc.utils?.update_system) {
		await game.dc.utils.update_system();
	}
}

// ─── Editor render hook ───────────────────────────────────────────────────

function _is_keys_editor(editor) {
	return editor.path === "gear.keys" || editor.path === "char.gear.keys";
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Register the key gear type, partials, GM tab, templates, and socket.
 * Called from main.js on dcReady.
 */
export async function register_keys() {
	// Register socket listener
	register_socket();

	// Ensure gear.keys collection exists
	_ensure_gear_keys();

	// Register localization strings (no system lang file edits needed)
	game.dc.register_localization("dc.marshal.sheet.tabs.gear.tabs.keys.label", "Keys");
	game.dc.register_localization("dc.marshal.sheet.tabs.gear.tabs.keys.header", "Keys");
	game.dc.register_localization("dc.marshal.sheet.tabs.gear.tabs.keys.add", "Add Key");
	game.dc.register_localization("dc.marshal.sheet.tabs.gear.tabs.keys.hint", [
		"Keys open locked doors, Marshal.  Create a key item here, then paste the wall UUID of the door it should open.  You can copy any wall's UUID from its configuration sheet — there's a copy-ID button right there.",
		"Give keys to NPCs in their gear and they'll be able to path through locked doors automatically, re-locking them behind.  Give keys to players and they can use them to unlock doors when standing adjacent.",
	].join("\n"));

	const rarity_options = game.dc.system.equipment.rarity || {};
	const editor_schema = build_editor_schema(rarity_options);
	const viewer_schema = build_viewer_schema(rarity_options);

	game.dc.register_gear_type("keys", {
		editor_schema,
		viewer_schema,
		viewer_partial: "modules/dc-npc-patrols/templates/keys/viewer_keys.hbs",
		use_handler,
	});

	game.dc.register_gear_partial("keys", {
		label: "Keys",
		player_partial: "modules/dc-npc-patrols/templates/keys/gear_keys.hbs",
		gm_partial: "modules/dc-npc-patrols/templates/keys/gm_keys.hbs",
		gm_tab: { id: "keys", label: "Keys", order: 55 },
		order: 55,
	});

	game.dc.register_gm_tab("dc-npc-patrols.keys", {
		group: "gear",
		id: "keys",
		label: "Keys",
		order: 55,
	});

	game.dc.register_gear_templates("keys", key_templates);

	// Editor render hook — normalize key data on editor open
	Hooks.on("dcEditorRender", (editor, element) => {
		if (!_is_keys_editor(editor)) return;
		normalize_key_data(editor.data);
	});

	// Expose key utilities via module API
	const mod = game.modules.get(MODULE_ID);
	if (mod) {
		mod.api = mod.api || {};
		mod.api.key = {
			request_key_unlock,
			normalize_key_data,
			key_data_defaults,
		};
	}

	console.log("[dc-npc-patrols] Key gear type registered.");
}

export { normalize_key_data, key_data_defaults };