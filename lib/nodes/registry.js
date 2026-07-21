/**
 * registry.js — Behaviour Tree node registry.
 *
 * Central registry for BT node types.  Each node file calls register_node()
 * to add itself.  Consumers (engine, editor, io) import NODE_REGISTRY from
 * here instead of the old monolithic bt_nodes.js.
 *
 * External modules can also register nodes via the module API:
 *   game.modules.get('dc-npc-patrols').api.register_node(type, def)
 */

export const NODE_REGISTRY = {};

/**
 * Register a node type definition.
 * @param {string} type — unique node type identifier
 * @param {object} def  — { category, label, icon, description, tick, editor? }
 */
export function register_node(type, def) {
	NODE_REGISTRY[type] = def;
}

/** Get a node definition by type. */
export function get_node_def(type) {
	return NODE_REGISTRY[type] ?? null;
}

/** Get all registered node types as { type: def } entries. */
export function get_all_nodes() {
	return NODE_REGISTRY;
}