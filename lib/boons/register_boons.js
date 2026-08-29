/**
 * register_boons.js — registers modify_flag and flag_condition boon types
 * and their editor templates with the Deadlands-Classic system.
 *
 * Called from main.js on dcReady.
 */
import modify_flag from "./modify_flag.js";
import flag_condition from "./flag_condition.js";
import modify_quest from "./modify_quest.js";

const MODULE_ID = "dc-npc-patrols";

export function register_boons() {
	// --- Localization (register before boon types so labels resolve) ---
	game.dc.register_localization("dc.boons.modify_flag", "Modify Flag");
	game.dc.register_localization("dc.boons.flag_condition", "Flag Condition");
	game.dc.register_localization("dc.boons.flag_mode", "Mode");
	game.dc.register_localization("dc.boons.flag_mode_set", "Set (create / update)");
	game.dc.register_localization("dc.boons.flag_mode_increment", "Increment (add to current)");
	game.dc.register_localization("dc.boons.flag_mode_delete", "Delete (remove)");
	game.dc.register_localization("dc.boons.flag_scope_type", "Scope");
	game.dc.register_localization("dc.boons.flag_scope_actor", "Actor");
	game.dc.register_localization("dc.boons.flag_scope_posse", "Posse");
	game.dc.register_localization("dc.boons.flag_key", "Flag Key");
	game.dc.register_localization("dc.boons.flag_value", "Flag Value");
	game.dc.register_localization("dc.boons.expected_value", "Expected Value");
	game.dc.register_localization("dc.boons.satisfied_boons", "Satisfied Boons");
	game.dc.register_localization("dc.boons.unsatisfied_boons", "Unsatisfied Boons (condition not met)");
	game.dc.register_localization("dc.boons.modify_quest", "Modify Quest");
	game.dc.register_localization("dc.boons.quest_mode", "Mode");
	game.dc.register_localization("dc.boons.quest_mode_add", "Add (grant from definition)");
	game.dc.register_localization("dc.boons.quest_mode_set_stage", "Set Stage");
	game.dc.register_localization("dc.boons.quest_mode_advance", "Advance Stage");
	game.dc.register_localization("dc.boons.quest_mode_complete", "Complete");
	game.dc.register_localization("dc.boons.quest_mode_set_var", "Set Variable");
	game.dc.register_localization("dc.boons.quest_mode_delete", "Delete");
	game.dc.register_localization("dc.boons.quest_id", "Quest");
	game.dc.register_localization("dc.boons.quest_stage", "Stage Index");
	game.dc.register_localization("dc.boons.quest_var_key", "Variable Key");
	game.dc.register_localization("dc.boons.quest_var_value", "Variable Value");

	// --- Handlers ---
	game.dc.boon_manager.register_boon_type("modify_flag", modify_flag);
	game.dc.boon_manager.register_boon_type("flag_condition", flag_condition);
	game.dc.boon_manager.register_boon_type("modify_quest", modify_quest);

	// --- Templates ---
	const quest_def_options = () => {
		const out = {};
		try {
			for (const [id, def] of Object.entries(game.settings.get(MODULE_ID, "quest_defs") || {})) {
				out[id] = def.title || id;
			}
		} catch { /* settings not ready */ }
		return out;
	};

	game.dc.register_boon_template("modify_quest", {
		new_object: {
			label: "Modify Quest", type: "modify_quest", trigger: "always",
			mode: "add", quest_id: "", stage: 0, var_key: "", var_value: "",
			scope_type: "posse",
			is_permanent: true, target: "self", scaling: null,
		},
		data: {
			label:      { key: "boon-label",       type: "text",     value: "label",       label: game.i18n.localize("dc.shared.label") },
			trigger:    { key: "boon-trigger",     type: "dropdown", value: "trigger",     options_path: "triggers", translation_path: "dc.triggers", label: game.i18n.localize("dc.shared.trigger") },
			mode:       { key: "boon-mode",        type: "dropdown", value: "mode",        options: {
				add: game.i18n.localize("dc.boons.quest_mode_add"),
				set_stage: game.i18n.localize("dc.boons.quest_mode_set_stage"),
				advance: game.i18n.localize("dc.boons.quest_mode_advance"),
				complete: game.i18n.localize("dc.boons.quest_mode_complete"),
				set_var: game.i18n.localize("dc.boons.quest_mode_set_var"),
				delete: game.i18n.localize("dc.boons.quest_mode_delete"),
			}, label: game.i18n.localize("dc.boons.quest_mode") },
			quest_id:   { key: "boon-quest_id",    type: "dropdown", value: "quest_id",    options: quest_def_options(), label: game.i18n.localize("dc.boons.quest_id") },
			stage:      { key: "boon-stage",       type: "number",   value: "stage",       label: game.i18n.localize("dc.boons.quest_stage"), condition: { field: "mode", values: ["set_stage"] } },
			var_key:    { key: "boon-var_key",     type: "text",     value: "var_key",     label: game.i18n.localize("dc.boons.quest_var_key"), condition: { field: "mode", values: ["set_var"] } },
			var_value:  { key: "boon-var_value",   type: "text",     value: "var_value",   label: game.i18n.localize("dc.boons.quest_var_value"), condition: { field: "mode", values: ["set_var"] } },
		},
	});

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
				increment: game.i18n.localize("dc.boons.flag_mode_increment"),
				delete: game.i18n.localize("dc.boons.flag_mode_delete"),
			}, label: game.i18n.localize("dc.boons.flag_mode") },
			scope_type:  { key: "boon-scope_type",  type: "dropdown", value: "scope_type",  options: {
				actor: game.i18n.localize("dc.boons.flag_scope_actor"),
				posse: game.i18n.localize("dc.boons.flag_scope_posse"),
			}, label: game.i18n.localize("dc.boons.flag_scope_type") },
			flag_key:    { key: "boon-flag_key",    type: "text",     value: "flag_key",    label: game.i18n.localize("dc.boons.flag_key") },
			flag_value:  { key: "boon-flag_value",  type: "text",     value: "flag_value",  label: game.i18n.localize("dc.boons.flag_value"), condition: { field: "mode", values: ["set", "increment"] } },
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