/**
 * loader.js — Central entry point for BT node and variable type registration.
 *
 * Imports all node files (static imports for core nodes) and calls their
 * register() functions.  Also registers core variable types.  After all
 * core registrations are done, fires the `dcBtNodesReady` hook so external
 * modules can register additional nodes and variable types.
 *
 * Consumers (bt_engine.js, bt_editor.js, bt_io.js, bt_variables.js) import
 * NODE_REGISTRY and VARIABLE_TYPE_REGISTRY from here instead of bt_nodes.js.
 */

// Re-export registries and helpers
import { NODE_REGISTRY, register_node, get_node_def, get_all_nodes } from "./registry.js";
export { NODE_REGISTRY, register_node, get_node_def, get_all_nodes };
export {
	VARIABLE_TYPE_REGISTRY,
	register_variable_type,
	get_variable_type,
	get_variable_type_options,
	coerce_variable_value as coerce_var,
	typed_default,
	build_variable_field,
} from "./variable_registry.js";

import { register_core_variable_types } from "./core_variable_types.js";

// ── Composite ──────────────────────────────────────────────────
import { register as register_sequence } from "./composite/sequence.js";
import { register as register_selector } from "./composite/selector.js";
import { register as register_parallel } from "./composite/parallel.js";
import { register as register_random_sequence } from "./composite/random_sequence.js";
import { register as register_random_selector } from "./composite/random_selector.js";

// ── Decorator ───────────────────────────────────────────────────
import { register as register_inverter } from "./decorator/inverter.js";
import { register as register_cooldown } from "./decorator/cooldown.js";

// ── Condition ───────────────────────────────────────────────────
import { register as register_flag } from "./condition/flag.js";
import { register as register_schedule } from "./condition/schedule.js";
import { register as register_combat } from "./condition/combat.js";
import { register as register_location } from "./condition/location.js";
import { register as register_in_region } from "./condition/in_region.js";
import { register as register_visible_tokens } from "./condition/visible_tokens.js";
import { register as register_range } from "./condition/range.js";
import { register as register_variable } from "./condition/variable.js";
import { register as register_character } from "./condition/character.js";
import { register as register_light } from "./condition/light.js";

// ── Action ──────────────────────────────────────────────────────
import { register as register_move_to } from "./action/move_to.js";
import { register as register_move_to_region } from "./action/move_to_region.js";
import { register as register_door_interact } from "./action/door_interact.js";
import { register as register_set_visible } from "./action/set_visible.js";
import { register as register_set_token_image } from "./action/set_token_image.js";
import { register as register_face } from "./action/face.js";
import { register as register_close_on_target } from "./action/close_on_target.js";
import { register as register_succeed } from "./action/succeed.js";
import { register as register_chat } from "./action/chat.js";
import { register as register_set_flag } from "./action/set_flag.js";
import { register as register_equip_item } from "./action/equip_item.js";
import { register as register_use_item } from "./action/use_item.js";
import { register as register_update_visible_tokens } from "./action/update_visible_tokens.js";
import { register as register_wait } from "./action/wait.js";
import { register as register_acquire_target } from "./action/acquire_target.js";
import { register as register_fire_weapon } from "./action/fire_weapon.js";
import { register as register_reload_weapon } from "./action/reload_weapon.js";
import { register as register_end_turn } from "./action/end_turn.js";
import { register as register_modify_item } from "./action/modify_item.js";
import { register as register_wander_region } from "./action/wander_region.js";

// ── Reference ──────────────────────────────────────────────────
import { register as register_subtree } from "./reference/subtree.js";

let _initialized = false;

/**
 * Register all core BT nodes and variable types.
 * Idempotent — only runs once.  After registration, fires the
 * `dcBtNodesReady` hook so modules can register additional nodes/types.
 */
export function init_bt_nodes() {
	if (_initialized) return;
	_initialized = true;

	// Register core variable types
	register_core_variable_types();

	// Composite
	register_sequence();
	register_selector();
	register_parallel();
	register_random_sequence();
	register_random_selector();

	// Decorator
	register_inverter();
	register_cooldown();

	// Condition
	register_flag();
	register_schedule();
	register_combat();
	register_location();
	register_in_region();
	register_visible_tokens();
	register_range();
	register_variable();
	register_character();
	register_light();

	// Action
	register_move_to();
	register_move_to_region();
	register_door_interact();
	register_set_visible();
	register_set_token_image();
	register_face();
	register_close_on_target();
	register_succeed();
	register_chat();
	register_set_flag();
	register_equip_item();
	register_use_item();
	register_update_visible_tokens();
	register_wait();
	register_acquire_target();
	register_fire_weapon();
	register_reload_weapon();
	register_end_turn();
	register_modify_item();
	register_wander_region();

	// Reference
	register_subtree();

	const node_count = Object.keys(NODE_REGISTRY).length;
	console.log(`[dc-npc-patrols|bt:init] ${node_count} node types registered`, Object.keys(NODE_REGISTRY).sort());

	// Fire hook for external modules
	if (typeof Hooks !== "undefined") {
		Hooks.callAll("dcBtNodesReady");
	}
}