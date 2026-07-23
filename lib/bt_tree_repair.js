/**
 * bt_tree_repair.js — Fix tree structure issues that prevent runtime ticking.
 *
 * Also handles node-type migration: when nodes are renamed or merged,
 * a migration map rewrites old types to new ones with appropriate field
 * defaults so existing saved trees continue to work.
 */

const DECORATOR_TYPES = new Set(["inverter", "cooldown"]);

// ── Node-Type Migration Map ─────────────────────────────────────
// Maps old node type → { type, migrate: (node) => void }
// The migrate function is called after the type is rewritten to
// populate any new fields with values derived from old fields.
const NODE_MIGRATIONS = {
	// Renamed
	action_idle: {
		type: "action_succeed",
	},
	// Merged into action_chat
	action_emote: {
		type: "action_chat",
		migrate: (node) => {
			if (Array.isArray(node.lines) && node.lines.length) {
				node.lines = node.lines.join(";");
			}
		},
	},
	// Merged into action_face
	action_face_player: {
		type: "action_face",
		migrate: (node) => {
			// Legacy face_player defaults: scene_scan + players + range 3
			if (!node.source) node.source = "scene_scan";
			if (!node.filter) node.filter = "players";
			if (node.max_range == null && node.range != null) node.max_range = node.range;
			if (node.max_range == null) node.max_range = 3;
		},
	},
	action_face_target: {
		type: "action_face",
		migrate: (node) => {
			// Legacy face_target defaults: blackboard + range 0
			if (!node.source) node.source = "blackboard";
			if (node.max_range == null && node.range != null) node.max_range = node.range;
			if (node.max_range == null) node.max_range = 0;
		},
	},
	// Merged into action_move_to_region
	action_flee: {
		type: "action_move_to_region",
		migrate: (node) => {
			node.movement_mode = "flee";
		},
	},
	// Merged into action_set_visible
	action_sleep: {
		type: "action_set_visible",
		migrate: (node) => {
			node.visible = false;
			// sleeping_image → alternate_image
			if (node.sleeping_image) {
				node.alternate_image = node.sleeping_image;
				delete node.sleeping_image;
			}
			// Note: sleep used to pathfind to home_region first.
			// The new set_visible node does NOT pathfind — it just toggles
			// visibility. The user should add a move_to_region node before
			// this in the tree to replicate the full sleep behaviour.
			// We keep home_region in case the user wants to reference it.
		},
	},
	action_wake: {
		type: "action_set_visible",
		migrate: (node) => {
			node.visible = true;
		},
	},
	// Merged into condition_schedule
	condition_time: {
		type: "condition_schedule",
		migrate: (node) => {
			node.check = "time_window";
		},
	},
	condition_day: {
		type: "condition_schedule",
		migrate: (node) => {
			node.check = "day_of_week";
			// days was stored as text "0,1,2,3,4,5,6" — keep as-is
		},
	},
	condition_weather: {
		type: "condition_schedule",
		migrate: (node) => {
			node.check = "weather";
		},
	},
	// Merged into condition_combat
	condition_my_turn: {
		type: "condition_combat",
		migrate: (node) => {
			node.check = "my_turn";
		},
	},
	condition_can_move: {
		type: "condition_combat",
		migrate: (node) => {
			node.check = "can_move";
		},
	},
	// Merged into action_acquire_target
	action_measure_range: {
		type: "action_acquire_target",
		migrate: (node) => {
			node.measure_only = true;
		},
	},
};

/**
 * Migrate a single node's type if it appears in the migration map.
 * @param {Object} node
 * @returns {boolean} true if the node was migrated
 */
function _migrate_node_type(node) {
	if (!node?.type) return false;
	const migration = NODE_MIGRATIONS[node.type];
	if (!migration) return false;

	const old_type = node.type;
	node.type = migration.type;
	if (typeof migration.migrate === "function") {
		migration.migrate(node);
	}
	console.log(`[dc-npc-patrols|bt:repair] Migrated node ${node._id}: ${old_type} → ${migration.type}`);
	return true;
}

/**
 * Recursively walk a tree and migrate any deprecated node types.
 * @param {Object} node
 */
export function migrate_node_types(node) {
	if (!node) return;

	_migrate_node_type(node);

	if (node.children) {
		for (const child of node.children) {
			migrate_node_types(child);
		}
	}

	if (node.child) {
		migrate_node_types(node.child);
	}
}

/**
 * Hoist nodes attached via .child on non-decorator parents into the parent's
 * children array so composites actually tick them at runtime.
 * @param {Object} node
 * @param {Object|null} parent
 * @param {number|string|null} index
 */
export function repair_misplaced_child_nodes(node, parent = null, index = null) {
  if (!node) return;

  if (node.children) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      repair_misplaced_child_nodes(node.children[i], node, i);
    }
  }

  if (node.child && DECORATOR_TYPES.has(node.type)) {
    repair_misplaced_child_nodes(node.child, node, "child");
  }

  if (node.child && !DECORATOR_TYPES.has(node.type)) {
    const misplaced = node.child;
    delete node.child;
    if (parent?.children && typeof index === "number") {
      parent.children.splice(index + 1, 0, misplaced);
    }
  }
}