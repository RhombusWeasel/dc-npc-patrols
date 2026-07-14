/**
 * default_bts.js — Built-in behaviour tree templates.
 *
 * Ships 3 example trees that GMs can use as-is or clone and modify:
 *   - Townsperson: patrols by day, sleeps at night, flees in combat
 *   - Guard: patrols, reacts to combat by fleeing to alarm, faces players
 *   - Merchant: stays in shop, faces players, emotes, flees at night
 *
 * These are registered as world settings on first load if no BTs exist.
 */

let _node_id_counter = 0;
function _nid() { return `n${++_node_id_counter}_${Math.random().toString(36).slice(2, 6)}`; }

export function get_default_bts() {
	return {
		bt_townsperson: {
			id: "bt_townsperson",
			name: "Townsperson",
			description: "Patrols by day, sleeps at night, flees in combat, reacts to town alarm.",
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
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "22:00", end_time: "06:00" },
							{ _id: _nid(), type: "action_sleep", _label: "" },
						],
					},
					{
						_id: _nid(),
						type: "sequence",
						_label: "Wake up",
						children: [
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "06:00", end_time: "22:00" },
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
														{ _id: _nid(), type: "action_face_player", _label: "", range: 3 },
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
								seconds: 30,
								child: {
									_id: _nid(),
									type: "sequence",
									_label: "Watch",
									children: [
										{ _id: _nid(), type: "action_face_player", _label: "", range: 4 },
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
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "20:00", end_time: "08:00" },
							{ _id: _nid(), type: "action_sleep", _label: "" },
						],
					},
					{
						_id: _nid(),
						type: "sequence",
						_label: "Open for business",
						children: [
							{ _id: _nid(), type: "condition_time", _label: "", start_time: "08:00", end_time: "20:00" },
							{ _id: _nid(), type: "action_wake", _label: "" },
							{
								_id: _nid(),
								type: "cooldown",
								_label: "",
								seconds: 45,
								child: {
									_id: _nid(),
									type: "sequence",
									_label: "Greet customer",
									children: [
										{ _id: _nid(), type: "action_face_player", _label: "", range: 3 },
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
	};
}