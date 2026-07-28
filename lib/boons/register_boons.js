/**
 * register_boons.js — registers modify_flag and flag_condition boon types
 * and their editor templates with the Deadlands-Classic system.
 *
 * Called from main.js on dcReady.
 */
import modify_flag from "./modify_flag.js";
import flag_condition from "./flag_condition.js";

const MODULE_ID = "dc-npc-patrols";

export function register_boons() {
	// --- Localization (register before boon types so labels resolve) ---
	game.dc.register_localization("dc.boons.modify_flag", "Modify Flag");
	game.dc.register_localization("dc.boons.flag_condition", "Flag Condition");
	game.dc.register_localization("dc.boons.flag_mode", "Mode");
	game.dc.register_localization("dc.boons.flag_mode_set", "Set (create / update)");
	game.dc.register_localization("dc.boons.flag_mode_delete", "Delete (remove)");
	game.dc.register_localization("dc.boons.flag_scope_type", "Scope");
	game.dc.register_localization("dc.boons.flag_scope_actor", "Actor");
	game.dc.register_localization("dc.boons.flag_scope_posse", "Posse");
	game.dc.register_localization("dc.boons.flag_key", "Flag Key");
	game.dc.register_localization("dc.boons.flag_value", "Flag Value");
	game.dc.register_localization("dc.boons.expected_value", "Expected Value");
	game.dc.register_localization("dc.boons.satisfied_boons", "Satisfied Boons");
	game.dc.register_localization("dc.boons.unsatisfied_boons", "Unsatisfied Boons (condition not met)");

	// --- Handlers ---
	game.dc.boon_manager.register_boon_type("modify_flag", modify_flag);
	game.dc.boon_manager.register_boon_type("flag_condition", flag_condition);

	// --- Templates ---
	game.dc.register_boon_template("modify_flag", {
		new_object: {
			label: "Modify Flag", type: "modify_flag", trigger: "always",
			mode: "set", scope_type: "actor",
			flag_key: "", flag_value: true,
			is_permanent: true, target: "self", scaling: null,
		},
		data: {
			label:       { key: "boon-label",       type: "text",     value: "label",       label: game.i18n.localize("dc.shared.label") },
			trigger:     { key: "boon-trigger",     type: "dropdown", value: "trigger",     options_path: "triggers", translation_path: "dc.triggers", label: game.i18n.localize("dc.shared.trigger") },
			mode:        { key: "boon-mode",        type: "dropdown", value: "mode",        options: {
				set: game.i18n.localize("dc.boons.flag_mode_set"),
				delete: game.i18n.localize("dc.boons.flag_mode_delete"),
			}, label: game.i18n.localize("dc.boons.flag_mode") },
			scope_type:  { key: "boon-scope_type",  type: "dropdown", value: "scope_type",  options: {
				actor: game.i18n.localize("dc.boons.flag_scope_actor"),
				posse: game.i18n.localize("dc.boons.flag_scope_posse"),
			}, label: game.i18n.localize("dc.boons.flag_scope_type") },
			flag_key:    { key: "boon-flag_key",    type: "text",     value: "flag_key",    label: game.i18n.localize("dc.boons.flag_key") },
			flag_value:  { key: "boon-flag_value",  type: "text",     value: "flag_value",  label: game.i18n.localize("dc.boons.flag_value"), condition: { field: "mode", value: "set" } },
		},
	});

	game.dc.register_boon_template("flag_condition", {
		new_object: {
			label: "Flag Condition", type: "flag_condition", trigger: "always",
			scope_type: "actor",
			flag_key: "", operator: "exists", expected_value: null,
			satisfied_boons: [], unsatisfied_boons: [],
			is_permanent: true, target: "self", scaling: null,
		},
		data: {
			label:             { key: "boon-label",             type: "text",      value: "label",             label: game.i18n.localize("dc.shared.label") },
			trigger:           { key: "boon-trigger",           type: "dropdown",  value: "trigger",           options_path: "triggers", translation_path: "dc.triggers", label: game.i18n.localize("dc.shared.trigger") },
			scope_type:        { key: "boon-scope_type",        type: "dropdown",  value: "scope_type",        options: {
				actor: game.i18n.localize("dc.boons.flag_scope_actor"),
				posse: game.i18n.localize("dc.boons.flag_scope_posse"),
			}, label: game.i18n.localize("dc.boons.flag_scope_type") },
			flag_key:          { key: "boon-flag_key",          type: "text",      value: "flag_key",          label: game.i18n.localize("dc.boons.flag_key") },
			operator:          { key: "boon-operator",          type: "dropdown",  value: "operator",          options: {
				exists: "Exists", not_exists: "Does Not Exist",
				equals: "Equals", not_equals: "Not Equals",
				greater: "Greater Than", less: "Less Than",
				greater_eq: "Greater or Equal", less_eq: "Less or Equal",
				contains: "Contains", starts_with: "Starts With",
			}, label: game.i18n.localize("dc.shared.operator") },
			expected_value:    { key: "boon-expected_value",    type: "text",      value: "expected_value",    label: game.i18n.localize("dc.boons.expected_value") },
			satisfied_boons:   { key: "boon-satisfied_boons",   type: "boon_list", value: "satisfied_boons",   label: game.i18n.localize("dc.boons.satisfied_boons") },
			unsatisfied_boons: { key: "boon-unsatisfied_boons", type: "boon_list", value: "unsatisfied_boons", label: game.i18n.localize("dc.boons.unsatisfied_boons") },
		},
	});
}