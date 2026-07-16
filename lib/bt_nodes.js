/**
 * bt_nodes.js — Behaviour Tree node registry.
 *
 * 24 node types across 4 categories:
 *   3 Composites: sequence, selector, parallel
 *   2 Decorators: inverter, cooldown
 *   8 Conditions: flag, time, combat, weather, day, location, in_region, visible_tokens
 *  13 Actions:   patrol, move_to, move_to_region, flee, sleep, wake,
 *                emote, face_player, chat, set_flag, wait, idle,
 *                equip_item, use_item, update_visible_tokens
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
import {
	_evaluate_operator,
	_fill_placeholders,
	_find_waypoint_by_label,
	_find_due_waypoints,
	_unix_to_minutes,
	_parse_time,
	_get_region_cells,
	_tile_has_change_level,
	_travel_rotation,
	TOKEN_MOVE_OPTS,
} from "./utils.js";
import {
	resolve_gear_path,
	equip_item,
	unequip_item,
	use_item,
	get_gear_item,
	get_equip_slot_options,
} from "./gear_actions.js";
import {
	get_visible_tokens,
	filter_token_records,
	write_visible_tokens_to_blackboard,
	get_token_filter_options,
} from "./token_vision.js";

export const NODE_REGISTRY = {};

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
		const key = `_seq_${node._id}`;
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
		const key = `_sel_${node._id}`;
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
		const key = `_par_${node._id}`;
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
		const key = `_cooldown_${node._id}`;
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
		const region = bb.scene.regions.find(r => r.name === node.region_name);
		if (!region) return Status.FAILURE;
		const grid = bb.scene.grid.size;
		const gw = Math.ceil(bb.scene.width / grid);
		const gh = Math.ceil(bb.scene.height / grid);
		const cells = _get_region_cells(region, gw, gh, grid);
		const tx = Math.floor(bb.token.x / grid);
		const ty = Math.floor(bb.token.y / grid);
		return cells.some(c => c.x === tx && c.y === ty) ? Status.SUCCESS : Status.FAILURE;
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
		if (bb.moving) return Status.RUNNING;

		// If we have an in-progress path, continue stepping through it
		const move_key = `_move_path_${node._id}`;
		if (bb[move_key]) {
			const { path, index } = bb[move_key];
			if (index >= path.length) {
				// Path complete
				delete bb[move_key];
				return Status.SUCCESS;
			}
			// Process steps this tick — skip any tiles that contain a Change Level
			// region, teleporting across them with a single displace move.
			bb.moving = true;
			bb._currently_moving = true;
			try {
				const grid = bb.scene.grid.size;
				const step = path[index];

				// Check if the current step's tile contains a Change Level region.
				// If so, skip it: find the next non-Change-Level step and teleport
				// there in a single move() with action: "displace" so the Change
				// Level confirmation dialog never fires.
				const px = step.x * grid;
				const py = step.y * grid;
				if (_tile_has_change_level(bb.scene, px, py, grid)) {
					// Find next step that is NOT on a Change Level tile
					let skip_to = index + 1;
					while (skip_to < path.length) {
						const s = path[skip_to];
						if (!_tile_has_change_level(bb.scene, s.x * grid, s.y * grid, grid)) break;
						skip_to++;
					}
					if (skip_to >= path.length) {
						// All remaining steps are on Change Level tiles — just displace
						// to the current step (the last stairs tile).
						skip_to = index;
					}
					const dest = path[skip_to];
					const dest_px = dest.x * grid;
					const dest_py = dest.y * grid;
					const dest_level = dest.level_id ?? bb.level_id;
					const level = dest_level !== '_default' ? bb.scene.levels.get(dest_level) : null;

					// Single move with displace: x/y + level + elevation combined.
					// Foundry's ChangeLevelRegionBehaviorType skips the dialog when
					// the final waypoint's action is "displace".
					const move_data = {
						x: dest_px, y: dest_py,
						action: "displace",
					};
					if (dest_level !== '_default' && dest_level !== bb.level_id) {
						move_data.level = dest_level;
						move_data.elevation = level?.elevation?.base ?? bb.elevation;
					}
					await bb.token.move([move_data], { ...TOKEN_MOVE_OPTS, animate: false });
					if (dest_level !== '_default') {
						bb.level_id = dest_level;
						bb.elevation = level?.elevation?.base ?? bb.elevation;
					}

					// Skip all intermediate steps we teleported past
					bb[move_key].index = skip_to + 1;
				} else {
					// Normal step: animate to it
					await engine.animate_to(bb.token, step);
					if (step.level_id && step.level_id !== '_default' && step.level_id !== bb.level_id) {
						bb.level_id = step.level_id;
						const lvl = bb.scene.levels.get(step.level_id);
						bb.elevation = lvl?.elevation?.base ?? bb.elevation;
					}
					bb[move_key].index++;
				}
			} finally {
				bb.moving = false;
				bb._currently_moving = false;
			}
			return Status.RUNNING;
		}

		// Resolve destination: waypoint label, or raw grid coords
		const dest = node.waypoint_label
			? _find_waypoint_by_label(bb, node.waypoint_label)
			: { x: node.dest_x, y: node.dest_y, level_id: node.dest_elevation ?? null };
		if (!dest) return Status.FAILURE;

		// Convert grid coords to pixels for pathfinding (pathfinding expects pixel inputs)
		const grid = bb.scene.grid.size;
		const pf = engine.pathfinding;
		const path = pf.find_path(
			bb.scene,
			{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
			{ x: dest.x * grid, y: dest.y * grid, level_id: dest.level_id ?? bb.level_id }
		);
		if (!path || !path.length) return Status.FAILURE;

		// Store path for multi-tick execution
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
		if (bb.moving) return Status.RUNNING;

		// If we have an in-progress path, continue stepping through it
		const move_key = `_move_region_${node._id}`;
		if (bb[move_key]) {
			const { path, index, region_name } = bb[move_key];
			if (index >= path.length) {
				// Path complete — fire arrival events
				const last_step = path[path.length - 1];
				await engine.fire_arrival(bb.token, bb.actor, {
				region_name,
					x: last_step.x * bb.scene.grid.size,
					y: last_step.y * bb.scene.grid.size,
				});
				delete bb[move_key];
				return Status.SUCCESS;
			}
			// Process steps this tick — skip any tiles that contain a Change Level
			// region, teleporting across them with a single displace move.
			bb.moving = true;
			bb._currently_moving = true;
			try {
				const gs = bb.scene.grid.size;
				const step = path[index];
				console.log(`[dc-npc-patrols] move_to_region: step ${index}/${path.length} grid=(${step.x},${step.y}) px=(${step.x * gs},${step.y * gs}) level=${step.level_id}`);

				const px = step.x * gs;
				const py = step.y * gs;
				if (_tile_has_change_level(bb.scene, px, py, gs)) {
					// Find next step that is NOT on a Change Level tile
					let skip_to = index + 1;
					while (skip_to < path.length) {
						const s = path[skip_to];
						if (!_tile_has_change_level(bb.scene, s.x * gs, s.y * gs, gs)) break;
						skip_to++;
					}
					if (skip_to >= path.length) {
						// All remaining steps are on Change Level tiles — just displace
						// to the current step (the last stairs tile).
						skip_to = index;
					}
					const dest = path[skip_to];
					const dest_px = dest.x * gs;
					const dest_py = dest.y * gs;
					const dest_level = dest.level_id ?? bb.level_id;
					const level = dest_level !== '_default' ? bb.scene.levels.get(dest_level) : null;

					const move_data = {
						x: dest_px, y: dest_py,
						action: "displace",
					};
					if (dest_level !== '_default' && dest_level !== bb.level_id) {
						move_data.level = dest_level;
						move_data.elevation = level?.elevation?.base ?? bb.elevation;
					}
					await bb.token.move([move_data], { ...TOKEN_MOVE_OPTS, animate: false });
					if (dest_level !== '_default') {
						bb.level_id = dest_level;
						bb.elevation = level?.elevation?.base ?? bb.elevation;
					}

					bb[move_key].index = skip_to + 1;
				} else {
					// Normal step: animate to it
					await engine.animate_to(bb.token, step);
					if (step.level_id && step.level_id !== '_default' && step.level_id !== bb.level_id) {
						bb.level_id = step.level_id;
						const lvl = bb.scene.levels.get(step.level_id);
						bb.elevation = lvl?.elevation?.base ?? bb.elevation;
					}
					bb[move_key].index++;
				}
			} finally {
				bb.moving = false;
				bb._currently_moving = false;
			}
			return Status.RUNNING;
		}

		// Find the named region on the current scene
		const region = bb.scene.regions.find(r => r.name === node.region_name);
		if (!region) {
			console.warn(`[dc-npc-patrols] move_to_region: region "${node.region_name}" not found on scene.`);
			return Status.FAILURE;
		}

		// Multi-goal A*: path to nearest accessible cell inside the region
		const pf = engine.pathfinding;
		const path = pf.find_path_to_region(
			bb.scene,
			{ x: bb.token.x, y: bb.token.y, level_id: bb.level_id },
			node.region_name
		);
		if (!path || !path.length) {
			console.warn(`[dc-npc-patrols] move_to_region: no path found to "${node.region_name}" from (${bb.token.x}, ${bb.token.y}).`);
			return Status.FAILURE;
		}

		console.log(`[dc-npc-patrols] move_to_region: path to "${node.region_name}" = ${path.length} steps.`);

		// Debug: log full path as pixel coordinates
		const gs = bb.scene.grid.size;
		const path_log = path.map((s, i) => `[${i}] grid=(${s.x},${s.y}) px=(${s.x * gs},${s.y * gs}) level=${s.level_id}`);
		console.log(`[dc-npc-patrols] move_to_region: full path:\n${path_log.join('\n')}`);

		// Store path for multi-tick execution
		bb[move_key] = { path, index: 0, region_name: node.region_name };
		return Status.RUNNING;
	},
	editor: {
		fields: [
			{ key: "region_name", type: "region_select", label: "Region Name", default: "" },
		],
	},
});

// ACTION: FLEE — move to flee_target waypoint
register_node("action_flee", {
	category: "action",
	label: "Action: Flee",
	icon: "fa-solid fa-person-running",
	description: "Moves to the flee_target waypoint on the active path.",
	tick: async (node, bb, engine) => {
		if (bb.moving) return Status.RUNNING;
		const paths = bb.actor.getFlag(engine.module_id, "paths") || [];
		const path = paths.find(p => p.enabled);
		if (!path) return Status.FAILURE;
		const flee_wp = path.waypoints.find(w => w.flee_target) || path.waypoints[path.waypoints.length - 1];
		if (!flee_wp) return Status.FAILURE;

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
				bb._original_image = bb.token.texture?.src || bb.actor.prototypeToken.texture?.src;
				await bb.token.update({ "texture.src": node.sleeping_image });
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
			await bb.token.update({ "texture.src": bb._original_image });
			bb._original_image = null;
		}
		bb.sleep_state = 'awake';
		return Status.SUCCESS;
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
		const label = _fill_placeholders(node.item_label || "", bb).trim();
		if (!label) return Status.FAILURE;

		const gear_path = resolve_gear_path(bb.actor, label);
		if (!gear_path) return Status.FAILURE;

		const mode = node.mode || "equip";
		const ok = mode === "unequip"
			? await unequip_item(bb.actor, gear_path)
			: await equip_item(bb.actor, gear_path, node.equip_slot || "auto");
		return ok ? Status.SUCCESS : Status.FAILURE;
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
		const label = _fill_placeholders(node.item_label || "", bb).trim();
		if (!label) return Status.FAILURE;

		const gear_path = resolve_gear_path(bb.actor, label);
		if (!gear_path) return Status.FAILURE;

		const item = get_gear_item(bb.actor, gear_path);
		if (!item || !game.dc.utils.has_boon_trigger(item, "on_use")) return Status.FAILURE;

		const ok = await use_item(bb.actor, gear_path);
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
		const key = `_wait_${node._id}`;
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