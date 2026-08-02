/**
 * builtin_fragments.js — Pre-built behaviour tree fragment definitions.
 *
 * Each fragment is a plain data object with a stable id, display name,
 * description, tree structure (root node), and variable declarations.
 * When a GM inserts a built-in fragment, the system clones the tree,
 * regenerates node IDs, and namespaces variables — exactly like a
 * user-created fragment insert.
 *
 * Built-in fragments are NOT stored in the world bt_store; they are
 * defined in code and surfaced in the BT editor's "Built-in Fragments"
 * section. When inserted, they become a regular user-owned fragment
 * (saved to bt_store) so the GM can edit them further.
 */

// ── Fragment Definitions ────────────────────────────────────────

export const BUILTIN_FRAGMENTS = [
	{
		id: "builtin_scheduled_relocate",
		name: "Scheduled Relocate",
		description: "At this time on these days, go to this region.",
		root: {
			type: "sequence",
			children: [
				{
					type: "comment",
					text: "Only on these days of the week",
					_label: "",
				},
				{
					type: "condition_schedule",
					check: "day_of_week",
					days: [0, 1, 2, 3, 4, 5, 6],
					_label: "",
				},
				{
					type: "comment",
					text: "Only during this time window",
					_label: "",
				},
				{
					type: "condition_schedule",
					check: "time_window",
					start_time: "{{start_time}}",
					end_time: "{{end_time}}",
					_label: "",
				},
				{
					type: "action_move_to_region",
					region_name: "{{region}}",
					movement_mode: "normal",
					_label: "",
				},
			],
		},
		variables: [
			{ key: "start_time", label: "Start Time (HH:MM)", type: "text", default: "08:00" },
			{ key: "end_time", label: "End Time (HH:MM)", type: "text", default: "20:00" },
			{ key: "region", label: "Destination Region", type: "region_select", default: "" },
		],
	},

	{
		id: "builtin_wander_and_pause",
		name: "Wander and Pause",
		description: "Amble around this region, stopping between moves.",
		root: {
			type: "sequence",
			children: [
				{
					type: "action_wander_region",
					region_name: "{{region}}",
					_label: "",
				},
				{
					type: "action_wait",
					seconds: "{{pause_seconds}}",
					_label: "",
				},
			],
		},
		variables: [
			{ key: "region", label: "Wander Region", type: "region_select", default: "" },
			{ key: "pause_seconds", label: "Pause Between Moves (seconds)", type: "number", default: 10 },
		],
	},

	{
		id: "builtin_greet_nearby_players",
		name: "Greet Nearby Players",
		description: "If I see a player, face them and say hello. Rate-limited.",
		root: {
			type: "cooldown",
			seconds: "{{cooldown_seconds}}",
			child: {
				type: "sequence",
				children: [
					{
						type: "action_update_visible_tokens",
						blackboard_key: "visible_tokens",
						filter: "players",
						max_range: "{{detection_range}}",
						include_self: false,
						exclude_hidden: true,
						_label: "",
					},
					{
						type: "condition_visible_tokens",
						blackboard_key: "visible_tokens",
						min_count: 1,
						filter: "players",
						name_contains: "",
						refresh: false,
						_label: "",
					},
					{
						type: "action_face",
						face_direction: false,
						source: "scene_scan",
						filter: "players",
						actor_type: "any",
						disposition: "any",
						max_range: "{{detection_range}}",
						name_contains: "",
						exclude_hidden: true,
						_label: "",
					},
					{
						type: "action_chat",
						text: "",
						lines: "{{greeting_lines}}",
						post_to_chat: true,
						post_as_bubble: false,
						_label: "",
					},
				],
				_label: "",
			},
			_label: "",
		},
		variables: [
			{ key: "greeting_lines", label: "Greeting Lines (semicolon-separated)", type: "text", default: "Welcome!;How can I help you?;Take your time." },
			{ key: "detection_range", label: "Detection Range (grid squares)", type: "number", default: 3 },
			{ key: "cooldown_seconds", label: "Cooldown (seconds)", type: "number", default: 30 },
		],
	},

	{
		id: "builtin_challenge_intruder",
		name: "Challenge Intruder",
		description: "Same as Greet but with guard-flavoured defaults.",
		root: {
			type: "cooldown",
			seconds: "{{cooldown_seconds}}",
			child: {
				type: "sequence",
				children: [
					{
						type: "action_update_visible_tokens",
						blackboard_key: "visible_tokens",
						filter: "players",
						max_range: "{{detection_range}}",
						include_self: false,
						exclude_hidden: true,
						_label: "",
					},
					{
						type: "condition_visible_tokens",
						blackboard_key: "visible_tokens",
						min_count: 1,
						filter: "players",
						name_contains: "",
						refresh: false,
						_label: "",
					},
					{
						type: "action_face",
						face_direction: false,
						source: "scene_scan",
						filter: "players",
						actor_type: "any",
						disposition: "any",
						max_range: "{{detection_range}}",
						name_contains: "",
						exclude_hidden: true,
						_label: "",
					},
					{
						type: "action_chat",
						text: "",
						lines: "{{challenge_lines}}",
						post_to_chat: true,
						post_as_bubble: false,
						_label: "",
					},
				],
				_label: "",
			},
			_label: "",
		},
		variables: [
			{ key: "challenge_lines", label: "Challenge Lines (semicolon-separated)", type: "text", default: "Halt! State your business.;Who goes there?;This area is restricted." },
			{ key: "detection_range", label: "Detection Range (grid squares)", type: "number", default: 4 },
			{ key: "cooldown_seconds", label: "Cooldown (seconds)", type: "number", default: 60 },
		],
	},

	{
		id: "builtin_flee_to_safety",
		name: "Flee to Safety",
		description: "If combat breaks out, run.",
		root: {
			type: "sequence",
			children: [
				{
					type: "comment",
					text: "Only when combat is active",
					_label: "",
				},
				{
					type: "condition_combat",
					check: "active",
					_label: "",
				},
				{
					type: "action_move_to_region",
					region_name: "{{safe_region}}",
					movement_mode: "flee",
					_label: "",
				},
			],
		},
		variables: [
			{ key: "safe_region", label: "Safe Region (flee destination)", type: "region_select", default: "" },
		],
	},

	{
		id: "builtin_sleep_wake_cycle",
		name: "Sleep/Wake Cycle",
		description: "At night: walk home, swap to sleeping sprite. During day: restore original image.",
		root: {
			type: "selector",
			children: [
				{
					type: "sequence",
					children: [
						{
							type: "comment",
							text: "Night time — go home and sleep",
							_label: "",
						},
						{
							type: "condition_schedule",
							check: "time_window",
							start_time: "{{bedtime}}",
							end_time: "{{wake_time}}",
							_label: "",
						},
						{
							type: "action_move_to_region",
							region_name: "{{home_region}}",
							movement_mode: "normal",
							_label: "",
						},
						{
							type: "action_set_token_image",
							mode: "set",
							image_path: "{{sleeping_image}}",
							store_original: true,
							_label: "",
						},
					],
					_label: "",
				},
				{
					type: "comment",
					text: "Day time — restore original image (idempotent)",
					_label: "",
				},
				{
					type: "action_set_token_image",
					mode: "restore",
					image_path: "",
					store_original: true,
					_label: "",
				},
			],
		},
		variables: [
			{ key: "bedtime", label: "Bedtime (HH:MM)", type: "text", default: "22:00" },
			{ key: "wake_time", label: "Wake Time (HH:MM)", type: "text", default: "06:00" },
			{ key: "home_region", label: "Home Region (sleep destination)", type: "region_select", default: "" },
			{ key: "sleeping_image", label: "Sleeping Image Path (optional — blank = same image)", type: "text", default: "" },
		],
	},

	{
		id: "builtin_weather_shelter",
		name: "Weather Shelter",
		description: "If it's raining or snowing, go inside.",
		root: {
			type: "sequence",
			children: [
				{
					type: "comment",
					text: "Bad weather - seek shelter. Change weather to snow or add another condition for other types.",
					_label: "",
				},
				{
					type: "condition_schedule",
					check: "weather",
					weather: "rain",
					match: true,
					_label: "",
				},
				{
					type: "action_move_to_region",
					region_name: "{{shelter_region}}",
					movement_mode: "normal",
					_label: "",
				},
			],
		},
		variables: [
			{ key: "shelter_region", label: "Shelter Region (go inside when raining)", type: "region_select", default: "" },
		],
	},

	{
		id: "builtin_door_keeper",
		name: "Door Keeper",
		description: "Open a door at this time, close it at another.",
		root: {
			type: "selector",
			children: [
				{
					type: "sequence",
					children: [
						{
							type: "comment",
							text: "Open hours — keep door open",
							_label: "",
						},
						{
							type: "condition_schedule",
							check: "time_window",
							start_time: "{{open_time}}",
							end_time: "{{close_time}}",
							_label: "",
						},
						{
							type: "action_door_interact",
							wall_id: "{{door_id}}",
							target_state: "open",
							_label: "",
						},
					],
					_label: "",
				},
				{
					type: "comment",
					text: "After hours — close door",
					_label: "",
				},
				{
					type: "action_door_interact",
					wall_id: "{{door_id}}",
					target_state: "closed",
					_label: "",
				},
			],
		},
		variables: [
			{ key: "open_time", label: "Opening Time (HH:MM)", type: "text", default: "08:00" },
			{ key: "close_time", label: "Closing Time (HH:MM)", type: "text", default: "20:00" },
			{ key: "door_id", label: "Door Wall ID", type: "foundry_id", default: "" },
		],
	},
];

/**
 * Get all built-in fragment definitions.
 * @returns {Array<{id, name, description, root, variables}>}
 */
export function get_builtin_fragments() {
	return BUILTIN_FRAGMENTS;
}

/**
 * Get a single built-in fragment by id.
 * @param {string} id
 * @returns {object|null}
 */
export function get_builtin_fragment(id) {
	return BUILTIN_FRAGMENTS.find((f) => f.id === id) ?? null;
}