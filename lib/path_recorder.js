/**
 * path_recorder.js — Visual path recording via Foundry V14's planMovement() API.
 *
 * Lets the GM drag an NPC token to record a patrol route. Uses Foundry's
 * built-in movement planning UI (drag, CTRL+click for waypoints, right-click
 * to undo). The token stays in its original position — we never call
 * startMovement(), so no cleanup is needed.
 */

/**
 * Record a patrol path by letting the GM drag the token.
 *
 * @param {Token} token — The canvas Token placeable to record from.
 * @param {object} callbacks
 * @param {function} callbacks.on_complete — Called with converted waypoints array.
 * @param {function} callbacks.on_cancel — Called if the GM cancels (ESC / release with no movement).
 */
export async function record_path(token, { on_complete, on_cancel } = {}) {
	if (!token) {
		ui.notifications.warn(game.i18n.localize("dc-npc-patrols.panel.no_token_on_scene"));
		if (on_cancel) on_cancel();
		return;
	}

	// Show hint notification
	ui.notifications.info(game.i18n.localize("dc-npc-patrols.panel.record_path_hint"));

	// Enter Foundry's movement planning mode — no constraints, all actions allowed
	const plan = await token.planMovement({});

	// plan is null if the user dismissed (ESC, release without moving, paused non-GM, locked token)
	if (!plan) {
		if (on_cancel) on_cancel();
		return;
	}

	// Convert the planned waypoints to our patrol waypoint format
	// plan.waypoints: TokenMovementWaypoint[] — x/y are pixel coordinates
	// plan.origin: TokenPosition — the token's starting position (not included in waypoints)
	const waypoints = convert_waypoints(plan.waypoints, plan.origin, token);

	if (!waypoints.length) {
		if (on_cancel) on_cancel();
		return;
	}

	if (on_complete) on_complete(waypoints);
}

/**
 * Convert Foundry movement waypoints to patrol waypoint format.
 *
 * Foundry waypoints have x/y in pixels. Our patrol system stores x/y in
 * grid coordinates (the engine multiplies by grid.size to get pixels).
 *
 * @param {TokenMovementWaypoint[]} plan_waypoints — from planMovement()
 * @param {TokenPosition} origin — the token's starting position
 * @param {Token} token — the canvas token (for grid size lookup)
 * @returns {object[]} — patrol-format waypoints
 */
function convert_waypoints(plan_waypoints, origin, token) {
	const grid_size = token.document.parent.grid.size;
	const default_radius = game.settings.get("dc-npc-patrols", "proximity_radius");
	const now = Date.now();

	// plan.waypoints does NOT include the origin — it's the user-placed points only.
	// We include the origin as the first waypoint so the patrol starts from the
	// token's current position. The GM can delete it if they want.
	const all_points = [];

	// Add origin as first waypoint (the starting position of the patrol)
	all_points.push({
		x: origin.x,
		y: origin.y,
		is_origin: true,
	});

	// Add user-placed waypoints
	for (const wp of plan_waypoints) {
		all_points.push({
			x: wp.x,
			y: wp.y,
			is_origin: false,
		});
	}

	return all_points.map((pt, i) => ({
		id: `wp_${now}_${i}`,
		label: "",
		x: Math.round(pt.x / grid_size * 100) / 100, // pixel → grid coordinate
		y: Math.round(pt.y / grid_size * 100) / 100,
		time: "12:00", // default; GM assigns via table
		face_direction: null,
		linger_minutes: 0,
		scene_id: null, // always current scene (planMovement is single-scene)
		arrival_lines: [],
		ambient_lines: [],
		region_radius: default_radius,
	}));
}