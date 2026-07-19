/**
 * default_bts.js — Built-in behaviour tree templates.
 *
 * Ships 3 example trees that GMs can use as-is or clone and modify:
 *   - Townsperson: patrols by day, sleeps at night, flees in combat
 *   - Guard: patrols, reacts to combat by fleeing to alarm, faces players
 *   - Merchant: stays in shop, faces players, emotes, flees at night
 *
 * These trees use template variables ({{var}}) for per-NPC values so a
 * single tree can be reused across many NPCs with different homes,
 * paths, schedules, etc.  Each actor provides its own values via the
 * `bt_variables` flag; the BT's `variables` array declares the keys,
 * labels, types, and defaults.
 *
 * Registered as world settings on first load if no BTs exist.
 */

let _node_id_counter = 0;
function _nid() { return `n${++_node_id_counter}_${Math.random().toString(36).slice(2, 6)}`; }

export function get_default_bts() {
	return {
		bt_townsperson: {
			id: "bt_townsperson",
			name: "Townsperson",
			description: "Patrols by day, sleeps at night, flees in combat, reacts to town alarm.",
			variables: [
				{ key: "sleep_time", label: "Sleep Time", type: "text", default: "22:00" },
				{ key: "wake_time", label: "Wake Time", type: "text", default: "06:00" },
				{ key: "greet_range", label: "Greet Range", type: "number", default: 3 },
			],
			root: {
				_id: _nid(),
				type: "selector",
				_label: "",
				children: [
					{
						_id: _nid(),
						type: "sequence",
						_label: "Survive",
						children: [
							{ _id: _nid(), type: "condition_combat", _label: "" },
							{
								_id: _nid(),
								type: "selector",
								_label: "",
								children: [
									{
										_id: _nid(),
										type: "sequence",
										_label: "Flee to sheriff",
										children: [
											{ _id: _nid(), type: "condition_flag", _label: "", flag_key: "town_alarm", operator: "exists" },
											{ _id: _nid(), type: "action_flee", _label: "Flee to sheriff" },
										],
									},
									{ _id: _nid(), type: "action_flee", _label: "Flee home" },
								],
							},
						],
					},
					{
						_id: _nid(),
						type: "sequence",
						_label: "Sleep",
						children: [
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "{{sleep_time}}", end_time: "{{wake_time}}" },
							{ _id: _nid(), type: "action_sleep", _label: "" },
						],
					},
					{
						_id: _nid(),
						type: "sequence",
						_label: "Wake up",
						children: [
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "{{wake_time}}", end_time: "{{sleep_time}}" },
							{ _id: _nid(), type: "action_wake", _label: "" },
							{
								_id: _nid(),
								type: "selector",
								_label: "",
								children: [
									{
										_id: _nid(),
										type: "sequence",
										_label: "Normal day",
										children: [
											{ _id: _nid(), type: "action_patrol", _label: "" },
											{
												_id: _nid(),
												type: "cooldown",
												_label: "",
												seconds: 60,
												child: {
													_id: _nid(),
													type: "sequence",
													_label: "Greet",
													children: [
														{ _id: _nid(), type: "action_face_player", _label: "", range: "{{greet_range}}" },
														{ _id: _nid(), type: "action_emote", _label: "", lines: ["*waves*", "*nods*"] },
													],
												},
											},
										],
									},
									{ _id: _nid(), type: "action_idle", _label: "" },
								],
							},
						],
					},
				],
			},
		},

		bt_guard: {
			id: "bt_guard",
			name: "Guard",
			description: "Patrols route, faces players, flees to alarm in combat.",
			variables: [
				{ key: "watch_range", label: "Watch Range", type: "number", default: 4 },
				{ key: "watch_cooldown", label: "Watch Cooldown (seconds)", type: "number", default: 30 },
			],
			root: {
				_id: _nid(),
				type: "selector",
				_label: "",
				children: [
					{
						_id: _nid(),
						type: "sequence",
						_label: "Combat",
						children: [
							{ _id: _nid(), type: "condition_combat", _label: "" },
							{ _id: _nid(), type: "condition_my_turn", _label: "" },
							{ _id: _nid(), type: "action_flee", _label: "Flee to alarm" },
						],
					},
					{
						_id: _nid(),
						type: "sequence",
						_label: "Patrol",
						children: [
							{ _id: _nid(), type: "action_patrol", _label: "" },
							{
								_id: _nid(),
								type: "cooldown",
								_label: "",
								seconds: "{{watch_cooldown}}",
								child: {
									_id: _nid(),
									type: "sequence",
									_label: "Watch",
									children: [
										{ _id: _nid(), type: "action_face_player", _label: "", range: "{{watch_range}}" },
										{ _id: _nid(), type: "action_emote", _label: "", lines: ["*eyes you suspiciously*", "*rests hand on hilt*"] },
									],
								},
							},
						],
					},
				],
			},
		},

		bt_merchant: {
			id: "bt_merchant",
			name: "Merchant",
			description: "Stays in shop, faces and greets customers, sleeps at night.",
			variables: [
				{ key: "sleep_time", label: "Sleep Time", type: "text", default: "20:00" },
				{ key: "wake_time", label: "Wake Time", type: "text", default: "08:00" },
				{ key: "greet_range", label: "Greet Range", type: "number", default: 3 },
				{ key: "greet_cooldown", label: "Greet Cooldown (seconds)", type: "number", default: 45 },
			],
			root: {
				_id: _nid(),
				type: "selector",
				_label: "",
				children: [
					{
						_id: _nid(),
						type: "sequence",
						_label: "Sleep",
						children: [
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "{{sleep_time}}", end_time: "{{wake_time}}" },
							{ _id: _nid(), type: "action_sleep", _label: "" },
						],
					},
					{
						_id: _nid(),
						type: "sequence",
						_label: "Open for business",
						children: [
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "{{wake_time}}", end_time: "{{sleep_time}}" },
							{ _id: _nid(), type: "action_wake", _label: "" },
							{
								_id: _nid(),
								type: "cooldown",
								_label: "",
								seconds: "{{greet_cooldown}}",
								child: {
									_id: _nid(),
									type: "sequence",
									_label: "Greet customer",
									children: [
										{ _id: _nid(), type: "action_face_player", _label: "", range: "{{greet_range}}" },
										{ _id: _nid(), type: "action_emote", _label: "", lines: ["*smiles*", "*bows slightly*", "Welcome!"] },
									],
								},
							},
							{ _id: _nid(), type: "action_idle", _label: "" },
						],
					},
				],
			},
		},

		bt_fighter: {
			id: "bt_fighter",
			name: "Fighter",
			description: "On combat turn, acquires a target, faces them, and fires (Deadlands applies range penalties).",
			variables: [],
			root: {
				_id: _nid(),
				type: "selector",
				_label: "",
				children: [
					{
						_id: _nid(),
						type: "sequence",
						_label: "Combat turn",
						children: [
							{ _id: _nid(), type: "condition_combat", _label: "" },
							{ _id: _nid(), type: "condition_my_turn", _label: "" },
							{
								_id: _nid(),
								type: "selector",
								_label: "Attack or skip",
								children: [
									{
										_id: _nid(),
										type: "sequence",
										_label: "Attack",
										children: [
											{
												_id: _nid(),
												type: "action_acquire_target",
												_label: "",
												target_key: "target",
												source: "scene_scan",
												filter: "players",
												disposition: "any",
												require_visible: false,
											},
											{
												_id: _nid(),
												type: "action_face_target",
												_label: "",
												target_key: "target",
											},
											{ _id: _nid(), type: "action_fire_weapon", _label: "", target_key: "target" },
										],
									},
									{ _id: _nid(), type: "action_idle", _label: "No valid attack" },
								],
							},
							{ _id: _nid(), type: "action_end_turn", _label: "" },
						],
					},
					{ _id: _nid(), type: "action_idle", _label: "" },
				],
			},
		},
	};
}