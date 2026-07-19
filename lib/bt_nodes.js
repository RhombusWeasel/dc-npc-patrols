/**
 * bt_nodes.js — Behaviour Tree node registry.
 *
 * 36 node types across 4 categories:
 *   3 Composites: sequence, selector, parallel
 *   2 Decorators: inverter, cooldown
 *  12 Conditions: flag, time, combat, weather, day, location, in_region, visible_tokens,
 *                 range, variable, character, light
 *  20 Actions:   patrol, move_to, move_to_region, door_interact, flee, sleep, wake,
 *                set_token_image, emote, face_player, chat, set_flag, wait, idle,
 *                equip_item, use_item, update_visible_tokens,
 *                acquire_target, measure_range, fire_weapon, modify_item, wander_region
 *
 * Each node type registers with:
 *   category — composite|decorator|condition|action
 *   label    — display label for editor
 *   icon     — FontAwesome icon class
 *   description — tooltip text
 *   tick(node, bb, engine) — async function returning Status
 *   editor.fields — (optional) array of field definitions for the BT editor
 */

import { Status } from "./bt_engine.js";
import { bb_state_key } from "./bt_state.js";
import {
	_evaluate_operator,
	_fill_placeholders,
	_find_waypoint_by_label,
	_find_due_waypoints,
	_unix_to_minutes,
	_parse_time,
	_get_region_cells,
	_travel_rotation,
	_has_unresolved_variables,
} from "./utils.js";
import {
	resolve_gear_path,
	resolve_actor,
	equip_item,
	unequip_item,
	use_item,
	get_gear_item,
	is_gear_equipped,
	get_equip_slot_options,
} from "./gear_actions.js";
import {
	get_visible_tokens,
	filter_token_records,
	write_visible_tokens_to_blackboard,
	get_token_filter_options,
} from "./token_vision.js";
import {
	find_closest_token,
	find_closest_from_records,
	write_target_to_blackboard,
	resolve_token_ref,
	resolve_actor_ref,
	measure_token_range,
	get_actor_type_options,
	get_disposition_options,
	get_target_source_options,
	get_measure_mode_options,
	get_flag_operator_options,
} from "./token_target.js";
import { fire_equipped_weapon } from "./combat_actions.js";
import { is_dc_combat_active } from "./combat_turn.js";
import { has_movement_budget } from "./combat_movement.js";
import { modify_item_by_label, remove_item_by_label } from "./inventory_actions.js";
import { tick_move_path_node } from "./move_steps.js";
import { get_bt } from "./bt_store.js";
import { resolve_variables_for_defs } from "./bt_variables.js";
import {
	resolve_wall,
	set_door_state,
	door_state_from_key,
	is_token_adjacent_to_door,
} from "./doors.js";
import {
	store_original_texture,
	set_token_texture,
	restore_token_texture,
	get_token_image_mode_options,
} from "./token_image.js";
import { register_character_condition_node } from "./char_condition_node.js";
import { register_light_condition_node } from "./light_condition_node.js";

export const NODE_REGISTRY = {};

function _token_in_region(bb, region_name) {
	if (!bb.token || !region_name) return false;
	const region = bb.scene.regions.find(r => r.name === region_name);
	if (!region) return false;
	const grid = bb.scene.grid.size;
	const gw = Math.ceil(bb.scene.width / grid);
	const gh = Math.ceil(bb.scene.height / grid);
	const cells = _get_region_cells(region, gw, gh, grid);
	const tx = Math.floor(bb.token.x / grid);
	const ty = Math.floor(bb.token.y / grid);
	return cells.some(c => c.x === tx && c.y === ty);
}

/**
 * Register a node type definition.
 * @param {string} type   — unique node type identifier
 * @param {object} def    — { category, label, icon, description, tick, editor? }
 */
export function register_node(type, def) {
	NODE_REGISTRY[type] = def;
}

// ── Composite Nodes ──────────────────────────────────────────────

// SEQUENCE (stateful): run children left-to-right, fail on first failure,
// succeed when all succeed. Returns running if a child is running.
// Remembers which child was running and resumes from there on the next tick
// instead of restarting from child 0 — this is essential for long-running
// actions like move_to_region that span many ticks.
register_node("sequence", {
	category: "composite",
	label: "Sequence (AND)",
	icon: "fa-solid fa-arrow-right",
	description: "Runs children in order. Fails if any child fails. Resumes from the running child.",
	tick: async (node, bb, engine) => {
		const key = bb_state_key(bb, `_seq_${node._id}`);
		const children = node.children || [];
		let i = bb[key] ?? 0;
		for (; i < children.length; i++) {
			const status = await engine._tick_node(children[i], bb);
			if (status === Status.RUNNING) {
				bb[key] = i;
				return Status.RUNNING;
			}
			if (status === Status.FAILURE) {
				delete bb[key];
				return Status.FAILURE;
			}
			// SUCCESS — continue to next child
		}
		// All children succeeded — reset for next loop
		delete bb[key];
		return Status.SUCCESS;
	},
});

// SELECTOR (stateful): run children left-to-right, succeed on first success.
// Fails if all children fail. Returns running if a child is running.
// Remembers which child was running and resumes from there on the next tick
// instead of restarting from child 0 — same rationale as the stateful sequence.
register_node("selector", {
	category: "composite",
	label: "Selector (OR)",
	icon: "fa-solid fa-question",
	description: "Tries children in order. Succeeds on first success. Resumes from the running child.",
	tick: async (node, bb, engine) => {
		const key = bb_state_key(bb, `_sel_${node._id}`);
		const children = node.children || [];
		let i = bb[key] ?? 0;
		for (; i < children.length; i++) {
			const status = await engine._tick_node(children[i], bb);
			if (status === Status.RUNNING) {
				bb[key] = i;
				return Status.RUNNING;
			}
			if (status === Status.SUCCESS) {
				delete bb[key];
				return Status.SUCCESS;
			}
			// FAILURE — continue to next child
		}
		// All children failed — reset for next loop
		delete bb[key];
		return Status.FAILURE;
	},
});

// PARALLEL (stateful): run all children. Succeeds when N of M succeed.
// Fails if (M - N + 1) children fail (i.e. success is impossible).
// Remembers which children have already succeeded/failed and skips them
// on subsequent ticks — a completed child is not re-ticked.
register_node("parallel", {
	category: "composite",
	label: "Parallel",
	icon: "fa-solid fa-bars",
	description: "Runs children simultaneously. Succeeds when N succeed. Completed children are not re-ticked.",
	tick: async (node, bb, engine) => {
		const children = node.children || [];
		const required = node.required ?? children.length;
		const key = bb_state_key(bb, `_par_${node._id}`);
		let state = bb[key] ?? { successes: 0, failures: 0, done: {} };
		for (let i = 0; i < children.length; i++) {
			if (state.done[i]) continue;
			const status = await engine._tick_node(children[i], bb);
			if (status === Status.SUCCESS) {
				state.successes++;
				state.done[i] = true;
			}
			if (status === Status.FAILURE) {
				state.failures++;
				state.done[i] = true;
			}
		}
		if (state.successes >= required) {
			delete bb[key];
			return Status.SUCCESS;
		}
		if (state.failures > children.length - required) {
			delete bb[key];
			return Status.FAILURE;
		}
		bb[key] = state;
		return Status.RUNNING;
	},
});

// ── Decorator Nodes ─────────────────────────────────────────────

// INVERTER: invert child result (success↔failure, running stays running)
register_node("inverter", {
	category: "decorator",
	label: "Inverter (NOT)",
	icon: "fa-solid fa-circle-xmark",
	description: "Inverts child result.",
	tick: async (node, bb, engine) => {
		if (!node.child) return Status.FAILURE;
		const status = await engine._tick_node(node.child, bb);
		if (status === Status.SUCCESS) return Status.FAILURE;
		if (status === Status.FAILURE) return Status.SUCCESS;
		return Status.RUNNING;
	},
});

// COOLDOWN: prevent child re-execution for N seconds after success
register_node("cooldown", {
	category: "decorator",
	label: "Cooldown",
	icon: "fa-solid fa-clock",
	description: "Prevents re-execution for N seconds after success.",
	tick: async (node, bb, engine) => {
		if (!node.child) return Status.FAILURE;
		const now = bb.current_unixtime;
		const key = bb_state_key(bb, `_cooldown_${node._id}`);
		const last = bb[key] ?? 0;
		if (now - last < (node.seconds ?? 60)) return Status.FAILURE;
		const status = await engine._tick_node(node.child, bb);
		if (status === Status.SUCCESS) bb[key] = now;
		return status;
	},
	editor: {
		fields: [
			{ key: "seconds", type: "number", label: "Cooldown (seconds)", default: 60 },
		],
	},
});

// ── Condition Nodes (leaf — return success/failure, never running) ─

// CONDITION: FLAG — check an actor flag
register_node("condition_flag", {
	category: "condition",
	label: "Condition: Flag",
	icon: "fa-solid fa-flag",
	description: "Checks an actor flag. Same operators as flag_condition boon.",
	tick: async (node, bb) => {
		const actor = bb.actor;
		if (!actor) return Status.FAILURE;
		const scope = node.scope || 'dc-npc-patrols';
		const flag_path = node.flag_path || 'quest_flags';
		const key = node.flag_key;
		if (!key) return Status.FAILURE;
		const flag_root = actor.getFlag(scope, flag_path) || {};
		const actual = flag_root[key];
		return _evaluate_operator(actual, node.operator || 'exists', node.expected_value)
			? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "scope",        type: "text",    label: "Scope",        default: "dc-npc-patrols" },
			{ key: "flag_path",    type: "text",    label: "Flag Path",    default: "quest_flags" },
			{ key: "flag_key",     type: "text",    label: "Flag Key",     default: "" },
			{ key: "operator",     type: "dropdown", label: "Operator",   default: "exists",
				options: {
					exists: "Exists", not_exists: "Does Not Exist",
					equals: "Equals", not_equals: "Not Equals",
					greater: "Greater Than", less: "Less Than",
					greater_eq: "Greater or Equal", less_eq: "Less or Equal",
					contains: "Contains", starts_with: "Starts With",
				},
			},
			{ key: "expected_value", type: "text", label: "Expected Value", default: "" },
		],
	},
});

// CONDITION: TIME — check time of day
register_node("condition_time", {
	category: "condition",
	label: "Condition: Time",
	icon: "fa-solid fa-clock",
	description: "Checks if current time is within a window (supports overnight).",
	tick: async (node, bb) => {
		// Apply editor defaults — unset end_time was parsing as 00:00, not the shown default.
		const start = _parse_time(node.start_time || "06:00");
		const end = _parse_time(node.end_time || "22:00");
		const now = bb.current_minutes;
		const in_window = start <= end
			? (now >= start && now <= end)
			: (now >= start || now <= end);  // overnight
		return in_window ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "start_time", type: "text", label: "Start Time (HH:MM)", default: "06:00" },
			{ key: "end_time",   type: "text", label: "End Time (HH:MM)",   default: "22:00" },
		],
	},
});

// CONDITION: COMBAT — check if combat is active
register_node("condition_combat", {
	category: "condition",
	label: "Condition: Combat",
	icon: "fa-solid fa-swords",
	description: "Checks if a combat encounter is active.",
	tick: async (node, bb) => {
		return bb.combat_active ? Status.SUCCESS : Status.FAILURE;
	},
});

// CONDITION: MY TURN — check if this NPC's combat turn is active
register_node("condition_my_turn", {
	category: "condition",
	label: "Condition: My Turn",
	icon: "fa-solid fa-hourglass-start",
	description: "Checks if this NPC is currently taking their combat turn.",
	tick: async (node, bb) => {
		return bb.is_my_turn ? Status.SUCCESS : Status.FAILURE;
	},
});

// CONDITION: CAN MOVE — check if combat movement budget remains
register_node("condition_can_move", {
	category: "condition",
	label: "Condition: Can Move",
	icon: "fa-solid fa-shoe-prints",
	description: "Checks if this NPC still has Pace movement budget remaining during combat.",
	tick: async (node, bb) => {
		const mode = bb.movement_mode || "normal";
		return has_movement_budget(bb, mode) ? Status.SUCCESS : Status.FAILURE;
	},
});

// CONDITION: WEATHER — check scene weather flag
register_node("condition_weather", {
	category: "condition",
	label: "Condition: Weather",
	icon: "fa-solid fa-cloud-rain",
	description: "Checks the scene's weather flag.",
	tick: async (node, bb) => {
		const weather = bb.weather;
		const matches = weather === node.weather;
		return (node.match === false ? !matches : matches)
			? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "weather", type: "dropdown", label: "Weather", default: "rain",
				options: {
					clear: "Clear", rain: "Rain", snow: "Snow",
					storm: "Storm", fog: "Fog",
				},
			},
			{ key: "match", type: "dropdown", label: "Match Mode", default: true,
				options: { true: "Matches", false: "Does Not Match" },
			},
		],
	},
});

// CONDITION: DAY — check day of week
register_node("condition_day", {
	category: "condition",
	label: "Condition: Day",
	icon: "fa-solid fa-calendar",
	description: "Checks if today is one of the specified weekdays.",
	tick: async (node, bb) => {
		const days = node.days || [];
		if (!days.length) return Status.SUCCESS;
		return days.includes(bb.weekday) ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "days", type: "text", label: "Days (0=Sun..6=Sat, comma-sep)", default: "0,1,2,3,4,5,6" },
		],
	},
});

// CONDITION: LOCATION — check if token is at/near a waypoint
register_node("condition_location", {
	category: "condition",
	label: "Condition: At Location",
	icon: "fa-solid fa-location-dot",
	description: "Checks if token is at a named waypoint or within N grid squares.",
	tick: async (node, bb) => {
		if (!bb.token) return Status.FAILURE;
		const grid = bb.scene.grid.size;
		const wp = _find_waypoint_by_label(bb, node.waypoint_label);
		if (!wp) return Status.FAILURE;
		const dx = Math.abs(bb.token.x / grid - wp.x);
		const dy = Math.abs(bb.token.y / grid - wp.y);
		const dist = Math.sqrt(dx * dx + dy * dy);
		return dist <= (node.radius ?? 1) ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "waypoint_label", type: "text", label: "Waypoint Label", default: "" },
			{ key: "radius", type: "number", label: "Radius (grid squares)", default: 1 },
		],
	},
});

// CONDITION: IN_REGION — check if token is currently inside a named region
register_node("condition_in_region", {
	category: "condition",
	label: "Condition: In Region",
	icon: "fa-solid fa-vector-square",
	description: "Checks if the token is currently inside a named region on the scene.",
	tick: async (node, bb) => {
		if (!bb.token) return Status.FAILURE;
		return _token_in_region(bb, node.region_name) ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
		],
	},
});

// ── Action Nodes (leaf — may return running) ──────────────────────

// ACTION: PATROL — move to next due waypoint on the specified path
register_node("action_patrol", {
	category: "action",
	label: "Action: Patrol",
	icon: "fa-solid fa-route",
	description: "Moves to due waypoints on a path. Returns running while moving.",
	tick: async (node, bb, engine) => {
		if (bb.moving) return Status.RUNNING;

		// Get the path (by name or first enabled)
		const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
		const path = node.path_name
			? paths.find(p => p.name === node.path_name)
			: paths.find(p => p.enabled);
		if (!path) return Status.FAILURE;

		// Find due waypoints (time crossed since last tick)
		const old_min = _unix_to_minutes(bb.last_tick_unixtime);
		const new_min = bb.current_minutes;
		const due = _find_due_waypoints(path, old_min, new_min, bb.day_changed);
		if (!due.length) return Status.SUCCESS;  // nothing to do

		// Execute movement (calls existing animate_to / cross_scene)
		bb.moving = true;
		bb._currently_moving = true;
		try {
			for (const wp of due) {
				if (wp.scene_id && wp.scene_id !== bb.scene.id) {
					await engine.cross_scene.transition(bb.token, bb.actor, wp);
				} else {
					await engine.animate_to(bb.token, wp);
				}
				await engine.fire_arrival(bb.token, bb.actor, wp);
				bb.current_waypoint = wp.id;
			}
		} finally {
			bb.moving = false;
			bb._currently_moving = false;
		}
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "path_name", type: "text", label: "Path Name (blank = first enabled)", default: "" },
		],
	},
});

// ACTION: MOVE_TO — navigate to a waypoint or coordinate using A* pathfinding
register_node("action_move_to", {
	category: "action",
	label: "Action: Move To",
	icon: "fa-solid fa-location-arrow",
	description: "Navigates to a waypoint or coordinate using A* pathfinding around walls.",
	tick: async (node, bb, engine) => {
		const move_key = bb_state_key(bb, `_move_path_${node._id}`);
		const progress = await tick_move_path_node(bb, engine, move_key);
		if (progress === Status.RUNNING) return Status.RUNNING;
		if (progress === Status.SUCCESS) return Status.SUCCESS;

		const dest = node.waypoint_label
			? _find_waypoint_by_label(bb, node.waypoint_label)
			: { x: node.dest_x, y: node.dest_y, level_id: node.dest_elevation ?? null };
		if (!dest) return Status.FAILURE;

		const grid = bb.scene.grid.size;
		const path = engine.pathfinding.find_path(
			bb.scene,
			{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
			{ x: dest.x * grid, y: dest.y * grid, level_id: dest.level_id ?? bb.level_id }
		);
		if (!path?.length) return Status.FAILURE;

		bb[move_key] = { path, index: 0 };
		return Status.RUNNING;
	},
	editor: {
		fields: [
			{ key: "waypoint_label", type: "text", label: "Waypoint Label (blank = use coords)", default: "" },
			{ key: "dest_x", type: "number", label: "Dest X (grid)", default: 0 },
			{ key: "dest_y", type: "number", label: "Dest Y (grid)", default: 0 },
			{ key: "dest_elevation", type: "number", label: "Dest Elevation (blank = same level)", default: null },
		],
	},
});

// ACTION: MOVE_TO_REGION — navigate to the nearest accessible cell inside a
// named region using multi-goal A* pathfinding (multi-level, uses changeLevel stairs).
// Returns RUNNING while traversing the path, SUCCESS on arrival, FAILURE if no path.
register_node("action_move_to_region", {
	category: "action",
	label: "Action: Move To Region",
	icon: "fa-solid fa-vector-square",
	description: "Navigates to the nearest cell inside a named region using A* pathfinding. Fires arrival events on reaching the region.",
	tick: async (node, bb, engine) => {
		const region_name = (node.region_name || "").trim();
		if (!region_name || _has_unresolved_variables(region_name)) {
			return Status.FAILURE;
		}

		if (_token_in_region(bb, region_name)) {
			delete bb[bb_state_key(bb, `_move_region_${node._id}`)];
			return Status.SUCCESS;
		}

		const move_key = bb_state_key(bb, `_move_region_${node._id}`);
		const progress = await tick_move_path_node(bb, engine, move_key, {
			on_complete: async (state) => {
				const last_step = state.path[state.path.length - 1];
				await engine.fire_arrival(bb.token, bb.actor, {
					region_name: state.region_name,
					x: last_step.x * bb.scene.grid.size,
					y: last_step.y * bb.scene.grid.size,
				});
			},
		});
		if (progress === Status.RUNNING) return Status.RUNNING;
		if (progress === Status.SUCCESS) return Status.SUCCESS;

		const path = engine.pathfinding.find_path_to_region(
			bb.scene,
			{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
			region_name
		);
		if (!path?.length) return Status.FAILURE;

		bb[move_key] = { path, index: 0, region_name };
		return Status.RUNNING;
	},
	editor: {
		fields: [
			{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
		],
	},
});

// ACTION: DOOR_INTERACT — path to a door and set OPEN / CLOSED / LOCKED
register_node("action_door_interact", {
	category: "action",
	label: "Action: Door Interact",
	icon: "fa-solid fa-door-open",
	description: "Paths to a door wall and sets its state (open, closed, or locked). Works on regular, secret, and locked doors.",
	tick: async (node, bb, engine) => {
		const move_key = bb_state_key(bb, `_door_interact_${node._id}`);
		const wall_id = (node.wall_id || "").trim();
		const target_state = node.target_state || "open";

		if (!wall_id || _has_unresolved_variables(wall_id)) return Status.FAILURE;

		const progress = await tick_move_path_node(bb, engine, move_key, {
			on_complete: async (state) => {
				const wall = await resolve_wall(bb.scene, state.wall_id);
				if (!wall) return;
				const ds = door_state_from_key(state.target_state);
				if (wall.ds !== ds) await set_door_state(wall, ds);
			},
		});
		if (progress === Status.RUNNING) return Status.RUNNING;
		if (progress === Status.SUCCESS) return Status.SUCCESS;

		const wall = await resolve_wall(bb.scene, wall_id);
		if (!wall) return Status.FAILURE;

		const ds = door_state_from_key(target_state);
		if (wall.ds === ds) return Status.SUCCESS;

		const grid_data = engine.pathfinding.get_grid_data(bb.scene);
		if (is_token_adjacent_to_door(bb.token, wall, bb.scene, bb.level_id, grid_data)) {
			await set_door_state(wall, ds);
			return Status.SUCCESS;
		}

		const path = engine.pathfinding.find_path_to_wall(
			bb.scene,
			{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
			wall
		);
		if (!path?.length) return Status.FAILURE;

		bb[move_key] = { path, index: 0, wall_id, target_state };
		return Status.RUNNING;
	},
	editor: {
		fields: [
			{ key: "wall_id", type: "foundry_id", label: "Door Wall ID", default: "" },
			{
				key: "target_state",
				type: "dropdown",
				label: "Target State",
				default: "open",
				options: { open: "Open", closed: "Closed", locked: "Locked" },
			},
		],
	},
});

// ACTION: FLEE — move to flee_target waypoint
register_node("action_flee", {
	category: "action",
	label: "Action: Flee",
	icon: "fa-solid fa-person-running",
	description: "Moves to the flee_target waypoint on the active path. During combat, pathfinds with a 3× Pace budget per turn.",
	tick: async (node, bb, engine) => {
		if (bb.moving) return Status.RUNNING;

		const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
		const path = paths.find(p => p.enabled);
		if (!path) return Status.FAILURE;
		const flee_wp = path.waypoints.find(w => w.flee_target) || path.waypoints[path.waypoints.length - 1];
		if (!flee_wp) return Status.FAILURE;

		if (!is_dc_combat_active()) {
			bb.moving = true;
			bb._currently_moving = true;
			try {
				await engine.animate_to(bb.token, flee_wp);
				await engine.fire_arrival(bb.token, bb.actor, flee_wp);
			} finally {
				bb.moving = false;
				bb._currently_moving = false;
			}
			return Status.SUCCESS;
		}

		const move_key = bb_state_key(bb, `_flee_${node._id}`);
		const progress = await tick_move_path_node(bb, engine, move_key, {
			on_complete: async () => {
				bb.movement_mode = "normal";
				await engine.fire_arrival(bb.token, bb.actor, flee_wp);
			},
		});
		if (progress === Status.RUNNING) return Status.RUNNING;
		if (progress === Status.SUCCESS) return Status.SUCCESS;

		bb.movement_mode = "flee";
		const grid = bb.scene.grid.size;
		const route = engine.pathfinding.find_path(
			bb.scene,
			{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
			{
				x: flee_wp.x * grid,
				y: flee_wp.y * grid,
				level_id: flee_wp.level_id ?? bb.level_id,
			},
		);
		if (!route?.length) return Status.FAILURE;

		bb[move_key] = {
			path: route,
			index: 0,
			movement_mode: "flee",
			flee_wp,
		};
		return Status.RUNNING;
	},
});

// ACTION: SLEEP — hide token, teleport to home waypoint, optionally swap image
register_node("action_sleep", {
	category: "action",
	label: "Action: Sleep",
	icon: "fa-solid fa-bed",
	description: "Hides token, teleports to home waypoint. Use with condition_time.",
	tick: async (node, bb, engine) => {
		if (bb.sleep_state === 'asleep') return Status.SUCCESS;  // already asleep

		const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
		const path = paths.find(p => p.enabled);
		if (!path) return Status.FAILURE;
		const home_wp = path.waypoints.find(w => w.id === node.home_waypoint)
			|| path.waypoints.find(w => w.home);
		if (!home_wp) return Status.FAILURE;

		bb.moving = true;
		bb._currently_moving = true;
		try {
			await engine.animate_to(bb.token, home_wp);
			// Store original image if we'll swap
			if (node.sleeping_image) {
				store_original_texture(bb, bb.token, bb.actor);
				await set_token_texture(bb.token, node.sleeping_image);
			}
			await bb.token.update({ hidden: true });
		} finally {
			bb.moving = false;
			bb._currently_moving = false;
		}
		bb.sleep_state = 'asleep';
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "home_waypoint", type: "text", label: "Home Waypoint ID (blank = first 'home' waypoint)", default: "" },
			{ key: "sleeping_image", type: "text", label: "Sleeping Image Path (optional)", default: "" },
		],
	},
});

// ACTION: WAKE — show token, restore original image
register_node("action_wake", {
	category: "action",
	label: "Action: Wake",
	icon: "fa-solid fa-sun",
	description: "Shows token and restores image. Use after action_sleep.",
	tick: async (node, bb) => {
		if (bb.sleep_state === 'awake') return Status.SUCCESS;
		await bb.token.update({ hidden: false });
		if (bb._original_image) {
			await restore_token_texture(bb, bb.token, bb.actor);
		}
		bb.sleep_state = 'awake';
		return Status.SUCCESS;
	},
});

// ACTION: SET_TOKEN_IMAGE — change token texture for visual state
register_node("action_set_token_image", {
	category: "action",
	label: "Action: Set Token Image",
	icon: "fa-solid fa-image",
	description: "Sets, restores, or resets the token image. Supports {{var}} in image path.",
	tick: async (node, bb) => {
		if (!bb.token) return Status.FAILURE;

		const mode = node.mode || "set";

		if (mode === "restore") {
			const ok = await restore_token_texture(bb, bb.token, bb.actor);
			return ok ? Status.SUCCESS : Status.FAILURE;
		}

		if (mode === "prototype") {
			const src = bb.actor?.prototypeToken?.texture?.src;
			if (!src) return Status.FAILURE;
			if (node.store_original !== false) {
				store_original_texture(bb, bb.token, bb.actor);
			}
			await set_token_texture(bb.token, src);
			return Status.SUCCESS;
		}

		const image_path = _fill_placeholders(node.image_path || "", bb).trim();
		if (!image_path) return Status.FAILURE;

		if (node.store_original !== false) {
			store_original_texture(bb, bb.token, bb.actor);
		}
		const ok = await set_token_texture(bb.token, image_path);
		return ok ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "mode", type: "dropdown", label: "Mode", default: "set",
				options: get_token_image_mode_options(),
			},
			{ key: "image_path", type: "text", label: "Image Path (set mode)", default: "" },
			{ key: "store_original", type: "boolean", label: "Store Original Before Change", default: true },
		],
	},
});

// ACTION: EMOTE — play a random emote from a list
register_node("action_emote", {
	category: "action",
	label: "Action: Emote",
	icon: "fa-solid fa-face-smile",
	description: "Sends a random emote chat line and optionally rotates token.",
	tick: async (node, bb) => {
		const lines = node.lines || [];
		if (!lines.length) return Status.SUCCESS;
		const line = lines[Math.floor(Math.random() * lines.length)];
		const name = bb.token.name || bb.actor.name;
		ChatMessage.create({
			user: game.user.id,
			speaker: { alias: name },
			content: `<div class="dc-patrol-emote"><strong>${name}:</strong> ${line}</div>`,
			style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
		});
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "lines", type: "text", label: "Emote Lines (semicolon-separated)", default: "" },
		],
	},
});

// CONDITION: VISIBLE_TOKENS — check blackboard visible token list
register_node("condition_visible_tokens", {
	category: "condition",
	label: "Condition: Visible Tokens",
	icon: "fa-solid fa-binoculars",
	description: "Checks the blackboard visible-token list (optionally refreshes first).",
	tick: async (node, bb) => {
		const key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";

		if (node.refresh) {
			const scan = get_visible_tokens(bb.token, {
				filter: node.filter || "all",
				max_range: node.max_range ?? 0,
				include_self: node.include_self ?? false,
				exclude_hidden: node.exclude_hidden ?? true,
			});
			if (!scan.ok) return Status.FAILURE;
			write_visible_tokens_to_blackboard(bb, scan.tokens, key, bb.current_unixtime);
		}

		const filtered = filter_token_records(bb[key], {
			filter: node.filter || "all",
			name_contains: node.name_contains || "",
		});
		const min_count = node.min_count ?? 1;
		return filtered.length >= min_count ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "blackboard_key", type: "text", label: "Blackboard Key", default: "visible_tokens" },
			{ key: "min_count", type: "number", label: "Minimum Matches", default: 1 },
			{ key: "filter", type: "dropdown", label: "Filter", default: "all",
				options: get_token_filter_options(),
			},
			{ key: "name_contains", type: "text", label: "Name Contains", default: "" },
			{ key: "refresh", type: "boolean", label: "Refresh Before Check", default: false },
			{ key: "max_range", type: "number", label: "Refresh Max Range (squares, 0=unlimited)", default: 0 },
			{ key: "include_self", type: "boolean", label: "Refresh Include Self", default: false },
			{ key: "exclude_hidden", type: "boolean", label: "Refresh Exclude Hidden", default: true },
		],
	},
});

// ACTION: FACE_PLAYER — rotate token to face nearest player
register_node("action_face_player", {
	category: "action",
	label: "Action: Face Player",
	icon: "fa-solid fa-eye",
	description: "Rotates token to face the nearest player token within range.",
	tick: async (node, bb) => {
		let nearest = null;

		if (node.use_visible_tokens) {
			const key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";
			const visible = filter_token_records(bb[key], { filter: "players" });
			const entry = visible[0];
			if (entry) nearest = bb.scene.tokens.get(entry.token_id);
		} else {
			const range = (node.range ?? 3) * bb.scene.grid.size;
			let nearest_dist = Infinity;
			for (const t of bb.scene.tokens) {
				if (!t.actor?.hasPlayerOwner) continue;
				const dx = t.x - bb.token.x, dy = t.y - bb.token.y;
				const dist = Math.sqrt(dx * dx + dy * dy);
				if (dist < nearest_dist && dist <= range) {
					nearest = t; nearest_dist = dist;
				}
			}
		}

		if (!nearest) return Status.FAILURE;
		const rotation = _travel_rotation(bb.token.x, bb.token.y, nearest.x, nearest.y);
		if (rotation == null) return Status.FAILURE;
		await bb.token.update({ rotation }, { animate: true });
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "range", type: "number", label: "Range (grid squares)", default: 3 },
			{ key: "use_visible_tokens", type: "boolean", label: "Use Visible Tokens List", default: false },
			{ key: "blackboard_key", type: "text", label: "Blackboard Key", default: "visible_tokens" },
		],
	},
});

// ACTION: IDLE — do nothing, succeed immediately
register_node("action_idle", {
	category: "action",
	label: "Action: Idle",
	icon: "fa-solid fa-circle",
	description: "Does nothing. Useful as a fallback in selectors.",
	tick: async () => Status.SUCCESS,
});

// ACTION: CHAT — send a specific chat message
register_node("action_chat", {
	category: "action",
	label: "Action: Chat",
	icon: "fa-solid fa-comment",
	description: "Sends a chat message with optional dynamic placeholders.",
	tick: async (node, bb) => {
		const text = _fill_placeholders(node.text || "", bb);
		if (!text) return Status.SUCCESS;

		const name = bb.token.name || bb.actor.name;
		const post_to_chat = node.post_to_chat ?? true;
		const post_as_bubble = node.post_as_bubble ?? false;

		if (post_to_chat) {
			ChatMessage.create({
				user: game.user.id,
				speaker: {
					alias: name,
					scene: bb.token.parent?.id,
					token: bb.token.id,
				},
				content: `<div class="dc-patrol-chat"><strong>${name}:</strong> ${text}</div>`,
				style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
			});
		}

		if (post_as_bubble && canvas?.ready && canvas.hud?.bubbles) {
			const token = canvas.tokens.get(bb.token.id);
			if (token) {
				await canvas.hud.bubbles.broadcast(bb.token, text, { cssClasses: ["emote"] });
			}
		}

		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "text", type: "text", label: "Chat Text", default: "" },
			{ key: "post_to_chat", type: "boolean", label: "Post to Chat Log", default: true },
			{ key: "post_as_bubble", type: "boolean", label: "Show Token Bubble", default: false },
		],
	},
});

// ACTION: SET FLAG — set a flag on an actor (BT-level, not boon-level)
register_node("action_set_flag", {
	category: "action",
	label: "Action: Set Flag",
	icon: "fa-solid fa-flag",
	description: "Sets a flag on the NPC or target actor.",
	tick: async (node, bb) => {
		const actor = bb.actor;
		const scope = node.scope || 'dc-npc-patrols';
		const flag_path = node.flag_path || 'quest_flags';
		if (!node.flag_key) return Status.FAILURE;
		await actor.setFlag(scope, `${flag_path}.${node.flag_key}`, node.flag_value ?? true);
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "scope",      type: "text", label: "Scope",      default: "dc-npc-patrols" },
			{ key: "flag_path",   type: "text", label: "Flag Path",  default: "quest_flags" },
			{ key: "flag_key",    type: "text", label: "Flag Key",   default: "" },
			{ key: "flag_value",  type: "text", label: "Flag Value", default: "true" },
		],
	},
});

// ACTION: EQUIP ITEM — equip or unequip gear by inventory label
register_node("action_equip_item", {
	category: "action",
	label: "Action: Equip Item",
	icon: "fa-solid fa-shirt",
	description: "Equips or unequips an inventory item matched by label (supports {{var}} placeholders).",
	tick: async (node, bb) => {
		if (!game.dc || !bb.actor) return Status.FAILURE;
		const actor = resolve_actor(bb.actor);
		const label = _fill_placeholders(node.item_label || "", bb).trim();
		if (!label) return Status.FAILURE;

		const gear_path = resolve_gear_path(actor, label);
		if (!gear_path) return Status.FAILURE;

		const mode = node.mode || "equip";
		if (mode !== "unequip" && is_gear_equipped(actor, gear_path)) {
			return Status.SUCCESS;
		}

		const result = mode === "unequip"
			? await unequip_item(actor, gear_path)
			: await equip_item(actor, gear_path, node.equip_slot || "auto");
		return result.ok ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "item_label", type: "text", label: "Item Label", default: "" },
			{ key: "mode", type: "dropdown", label: "Mode", default: "equip",
				options: { equip: "Equip", unequip: "Unequip" },
			},
			{ key: "equip_slot", type: "dropdown", label: "Equip Slot", default: "auto",
				options: get_equip_slot_options(),
			},
		],
	},
});

// ACTION: USE ITEM — fire on_use boons for an inventory item (not attacks)
register_node("action_use_item", {
	category: "action",
	label: "Action: Use Item",
	icon: "fa-solid fa-hand-pointer",
	description: "Uses an inventory item that has a top-level on_use boon (partial label match).",
	tick: async (node, bb) => {
		if (!game.dc || !bb.actor) return Status.FAILURE;
		const actor = resolve_actor(bb.actor);
		const label = _fill_placeholders(node.item_label || "", bb).trim();
		if (!label) return Status.FAILURE;

		const gear_path = resolve_gear_path(actor, label);
		if (!gear_path) return Status.FAILURE;

		const item = get_gear_item(actor, gear_path);
		if (!item || !game.dc.utils.has_boon_trigger(item, "on_use")) return Status.FAILURE;

		const ok = await use_item(actor, gear_path);
		return ok ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "item_label", type: "text", label: "Item Label", default: "" },
		],
	},
});

// ACTION: UPDATE_VISIBLE_TOKENS — scan vision and write to blackboard
register_node("action_update_visible_tokens", {
	category: "action",
	label: "Action: Update Visible Tokens",
	icon: "fa-solid fa-binoculars",
	description: "Scans Foundry token vision and writes visible tokens to the blackboard.",
	tick: async (node, bb) => {
		const key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";
		const scan = get_visible_tokens(bb.token, {
			filter: node.filter || "all",
			max_range: node.max_range ?? 0,
			include_self: node.include_self ?? false,
			exclude_hidden: node.exclude_hidden ?? true,
		});
		if (!scan.ok) return Status.FAILURE;
		write_visible_tokens_to_blackboard(bb, scan.tokens, key, bb.current_unixtime);
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "blackboard_key", type: "text", label: "Blackboard Key", default: "visible_tokens" },
			{ key: "filter", type: "dropdown", label: "Filter", default: "all",
				options: get_token_filter_options(),
			},
			{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0 },
			{ key: "include_self", type: "boolean", label: "Include Self", default: false },
			{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true },
		],
	},
});

// ACTION: WAIT — return running for N seconds, then succeed
register_node("action_wait", {
	category: "action",
	label: "Action: Wait",
	icon: "fa-solid fa-hourglass",
	description: "Returns running for N seconds, then succeeds.",
	tick: async (node, bb) => {
		const key = bb_state_key(bb, `_wait_${node._id}`);
		if (!bb[key]) bb[key] = bb.current_unixtime;
		const elapsed = bb.current_unixtime - bb[key];
		if (elapsed >= (node.seconds ?? 5)) {
			delete bb[key];
			return Status.SUCCESS;
		}
		return Status.RUNNING;
	},
	editor: {
		fields: [
			{ key: "seconds", type: "number", label: "Wait (seconds)", default: 5 },
		],
	},
});

function _target_filter_options(node) {
	return {
		filter: node.filter || "all",
		actor_type: node.actor_type || "any",
		disposition: node.disposition || "any",
		max_range: node.max_range ?? 0,
		name_contains: node.name_contains || "",
		exclude_hidden: node.exclude_hidden ?? true,
	};
}

// ACTION: ACQUIRE_TARGET — find closest token and store on blackboard
register_node("action_acquire_target", {
	category: "action",
	label: "Action: Acquire Target",
	icon: "fa-solid fa-crosshairs",
	description: "Finds the closest matching token and stores it on the blackboard for combat or range checks.",
	tick: async (node, bb) => {
		if (!bb.token) return Status.FAILURE;

		const target_key = (node.target_key || "target").trim() || "target";
		const source = node.source || "scene_scan";
		const filter_opts = _target_filter_options(node);
		let record = null;

		if (source === "blackboard_list") {
			const list_key = (node.blackboard_key || "visible_tokens").trim() || "visible_tokens";
			record = find_closest_from_records(bb[list_key], bb.token, filter_opts);
		} else if (node.require_visible) {
			const scan = get_visible_tokens(bb.token, {
				filter: filter_opts.filter,
				max_range: filter_opts.max_range,
				include_self: false,
				exclude_hidden: filter_opts.exclude_hidden,
			});
			if (scan.ok) {
				record = find_closest_from_records(scan.tokens, bb.token, filter_opts);
			}
		} else {
			record = find_closest_token(bb.token, filter_opts);
		}

		if (!record) return Status.FAILURE;
		write_target_to_blackboard(bb, record, target_key);
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
			{ key: "source", type: "dropdown", label: "Source", default: "scene_scan",
				options: get_target_source_options(),
			},
			{ key: "blackboard_key", type: "text", label: "List Blackboard Key", default: "visible_tokens" },
			{ key: "filter", type: "dropdown", label: "Filter", default: "all",
				options: get_token_filter_options(),
			},
			{ key: "actor_type", type: "dropdown", label: "Actor Type", default: "any",
				options: get_actor_type_options(),
			},
			{ key: "disposition", type: "dropdown", label: "Disposition", default: "any",
				options: get_disposition_options(),
			},
			{ key: "max_range", type: "number", label: "Max Range (grid squares, 0=unlimited)", default: 0 },
			{ key: "name_contains", type: "text", label: "Name Contains", default: "" },
			{ key: "require_visible", type: "boolean", label: "Require Visible (scene scan only)", default: false },
			{ key: "exclude_hidden", type: "boolean", label: "Exclude Hidden", default: true },
		],
	},
});

// ACTION: MEASURE_RANGE — write distance to target on blackboard
register_node("action_measure_range", {
	category: "action",
	label: "Action: Measure Range",
	icon: "fa-solid fa-ruler",
	description: "Measures distance from this token to a blackboard target and stores it as {target_key}_range.",
	tick: async (node, bb) => {
		const target_key = (node.target_key || "target").trim() || "target";
		const target_doc = resolve_token_ref(bb, target_key);
		if (!target_doc || !bb.token) return Status.FAILURE;

		const mode = node.measure_mode || "grid_squares";
		bb[`${target_key}_range`] = measure_token_range(bb.token, target_doc, mode);
		return Status.SUCCESS;
	},
	editor: {
		fields: [
			{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
			{ key: "measure_mode", type: "dropdown", label: "Measure Mode", default: "grid_squares",
				options: get_measure_mode_options(),
			},
		],
	},
});

// ACTION: FIRE_WEAPON — attack blackboard target with equipped weapon
register_node("action_fire_weapon", {
	category: "action",
	label: "Action: Fire Weapon",
	icon: "fa-solid fa-gun",
	description: "Fires the equipped weapon at a blackboard target through the Deadlands combat pipeline.",
	tick: async (node, bb) => {
		if (!game.dc || !bb.actor || !bb.token) return Status.FAILURE;

		const target_key = (node.target_key || "target").trim() || "target";
		const target_doc = resolve_token_ref(bb, target_key);
		if (!target_doc) return Status.FAILURE;

		const weapon_label = _fill_placeholders(node.weapon_label || "", bb).trim();
		const result = await fire_equipped_weapon(bb.actor, bb.token, target_doc, {
			slot_key: node.slot_key || "main_hand",
			weapon_label: weapon_label || undefined,
		});
		return result.ok ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
			{ key: "slot_key", type: "dropdown", label: "Weapon Slot", default: "main_hand",
				options: get_equip_slot_options(),
			},
			{ key: "weapon_label", type: "text", label: "Weapon Label Override (blank = slot)", default: "" },
		],
	},
});

// ACTION: MODIFY_ITEM — add or remove gear by label
register_node("action_modify_item", {
	category: "action",
	label: "Action: Modify Item",
	icon: "fa-solid fa-box",
	description: "Adds or removes inventory items matched by partial label on self or a blackboard target actor.",
	tick: async (node, bb) => {
		if (!game.dc) return Status.FAILURE;

		const label = _fill_placeholders(node.item_label || "", bb).trim();
		if (!label) return Status.FAILURE;

		let actor = bb.actor;
		const target_key = (node.target_key || "").trim();
		if (target_key) {
			actor = resolve_actor_ref(bb, target_key) ?? actor;
		}
		if (!actor) return Status.FAILURE;

		const mode = node.mode || "add";
		const quantity = node.quantity ?? 1;
		const result = mode === "remove"
			? await remove_item_by_label(actor, label, quantity)
			: await modify_item_by_label(actor, label, quantity);
		return result.ok ? Status.SUCCESS : Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "item_label", type: "text", label: "Item Label", default: "" },
			{ key: "mode", type: "dropdown", label: "Mode", default: "add",
				options: { add: "Add", remove: "Remove" },
			},
			{ key: "quantity", type: "number", label: "Quantity", default: 1 },
			{ key: "target_key", type: "text", label: "Target Blackboard Key (blank = self)", default: "" },
		],
	},
});

// ACTION: WANDER_REGION — walk to a random reachable point in a region
register_node("action_wander_region", {
	category: "action",
	label: "Action: Wander Region",
	icon: "fa-solid fa-shuffle",
	description: "Picks a random reachable point inside a named region and pathfinds there.",
	tick: async (node, bb, engine) => {
		const region_name = (node.region_name || "").trim();
		if (!region_name || _has_unresolved_variables(region_name)) {
			return Status.FAILURE;
		}

		const move_key = bb_state_key(bb, `_wander_region_${node._id}`);
		const progress = await tick_move_path_node(bb, engine, move_key);
		if (progress === Status.RUNNING) return Status.RUNNING;
		if (progress === Status.SUCCESS) return Status.SUCCESS;

		const source = { x: bb.token.x, y: bb.token.y, level_id: bb.level_id };
		const dest = engine.pathfinding.pick_random_reachable_cell(bb.scene, source, region_name);
		if (!dest) return Status.FAILURE;

		const grid = bb.scene.grid.size;
		const path = engine.pathfinding.find_path(
			bb.scene,
			source,
			{
				x: dest.x * grid,
				y: dest.y * grid,
				level_id: dest.level_id ?? bb.level_id,
			}
		);
		if (!path?.length) return Status.FAILURE;

		bb[move_key] = { path, index: 0, region_name };
		return Status.RUNNING;
	},
	editor: {
		fields: [
			{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
		],
	},
});

// CONDITION: RANGE — compare distance to a blackboard target
register_node("condition_range", {
	category: "condition",
	label: "Condition: Range",
	icon: "fa-solid fa-ruler-horizontal",
	description: "Compares distance to a blackboard target against a threshold.",
	tick: async (node, bb) => {
		const target_key = (node.target_key || "target").trim() || "target";
		let range = bb[`${target_key}_range`];

		if (range == null) {
			const target_doc = resolve_token_ref(bb, target_key);
			if (!target_doc || !bb.token) return Status.FAILURE;
			range = measure_token_range(bb.token, target_doc, node.measure_mode || "grid_squares");
		}

		return _evaluate_operator(range, node.operator || "less_eq", node.value ?? 0)
			? Status.SUCCESS
			: Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "target_key", type: "text", label: "Target Blackboard Key", default: "target" },
			{ key: "operator", type: "dropdown", label: "Operator", default: "less_eq",
				options: get_flag_operator_options(),
			},
			{ key: "value", type: "number", label: "Range (grid squares)", default: 6 },
			{ key: "measure_mode", type: "dropdown", label: "Measure Mode (if not pre-measured)", default: "grid_squares",
				options: get_measure_mode_options(),
			},
		],
	},
});

// CONDITION: VARIABLE — check a tree template variable on this NPC
register_node("condition_variable", {
	category: "condition",
	label: "Condition: Variable",
	icon: "fa-solid fa-sliders",
	description: "Checks a behaviour-tree template variable resolved for this NPC (e.g. is_believer).",
	tick: async (node, bb) => {
		const variable_key = (node.variable_key || "").trim();
		if (!variable_key) return Status.FAILURE;

		const actual = bb.variables?.[variable_key];
		let expected = node.expected_value;
		if (typeof actual === "boolean") {
			expected = expected === true || expected === "true" || expected === "1";
		}

		return _evaluate_operator(actual, node.operator || "equals", expected)
			? Status.SUCCESS
			: Status.FAILURE;
	},
	editor: {
		fields: [
			{ key: "variable_key", type: "text", label: "Variable Key", default: "" },
			{ key: "operator", type: "dropdown", label: "Operator", default: "equals",
				options: get_flag_operator_options(),
			},
			{ key: "expected_value", type: "text", label: "Expected Value", default: "" },
		],
	},
});

// REFERENCE: SUBTREE — live link to a fragment (ticks fragment root at runtime)
register_node("subtree", {
	category: "reference",
	label: "Fragment Link",
	icon: "fa-solid fa-link",
	description: "Live reference to a fragment. Ticks the fragment root at runtime.",
	tick: async (node, bb, engine) => {
		const fragment_id = (node.bt_id || "").trim();
		if (!fragment_id) return Status.FAILURE;

		const fragment = get_bt(fragment_id);
		if (!fragment?.root) return Status.FAILURE;

		const prev_scope = bb._tick_scope ?? "";
		const prev_vars = bb.variables;
		const scope_prefix = `${prev_scope}${node._id}/`;
		bb._tick_scope = scope_prefix;
		bb.variables = {
			...prev_vars,
			...resolve_variables_for_defs(bb.actor, fragment.variables || []),
		};

		const fragment_root = foundry.utils.deepClone(fragment.root);
		try {
			engine._ensure_node_ids(fragment_root, `${scope_prefix}r`);
			return await engine._tick_node(fragment_root, bb);
		} finally {
			bb._tick_scope = prev_scope;
			bb.variables = prev_vars;
		}
	},
	editor: {
		fields: [
			{ key: "bt_id", type: "fragment_select", label: "Fragment", default: "" },
		],
	},
});

register_character_condition_node(register_node, Status);
register_light_condition_node(register_node, Status);