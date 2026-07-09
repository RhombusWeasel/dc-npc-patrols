/**
 * path_recorder.js — Visual path recording via Foundry V14's planMovement() API.
 *
 * Lets the GM drag an NPC token to record a patrol route. Uses Foundry's
 * built-in movement planning UI (drag, CTRL+click for waypoints, right-click
 * to undo). The token stays in its original position — we never call
 * startMovement(), so no cleanup is needed.
 *
 * The recording produces a SINGLE waypoint (the final destination) with a
 * `route` array of intermediate grid points. The engine animates the token
 * through the route in one continuous movement when the waypoint's time
 * triggers.
 */

/**
 * Record a patrol path by letting the GM drag the token.
 *
 * @param {Token} token — The canvas Token placeable to record from.
 * @param {object} callbacks
 * @param {function} callbacks.on_complete — Called with a single waypoint object (with route array).
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

	// Convert the planned movement to a single waypoint with a route array
	const waypoint = convert_to_waypoint(plan, token);

	if (!waypoint) {
		if (on_cancel) on_cancel();
		return;
	}

	if (on_complete) on_complete(waypoint);
}

/**
 * Convert a Foundry movement plan into a single patrol waypoint with a route.
 *
 * The plan contains:
 *   - plan.origin: TokenPosition — the token's starting position (not in waypoints)
 *   - plan.destination: TokenPosition — the final position
 *   - plan.waypoints: TokenMovementWaypoint[] — intermediate points (x/y in pixels)
 *
 * We produce:
 *   - waypoint.x, waypoint.y = destination (grid coords)
 *   - waypoint.route = intermediate points (grid coords), excluding origin and destination
 *
 * @param {object} plan — Result from token.planMovement()
 * @param {Token} token — The canvas token (for grid size lookup)
 * @returns {object|null} — A single patrol-format waypoint with route array
 */
function convert_to_waypoint(plan, token) {
	const grid_size = token.document.parent.grid.size;
	const default_radius = game.settings.get("dc-npc-patrols", "proximity_radius");
	const now = Date.now();

	// Gather all points from the plan waypoints (pixel coords)
	const all_points = (plan.waypoints || []).map((wp) => ({ x: wp.x, y: wp.y }));

	// If the destination isn't already the last waypoint, append it
	if (plan.destination) {
		const last = all_points[all_points.length - 1];
		if (!last || last.x !== plan.destination.x || last.y !== plan.destination.y) {
			all_points.push({ x: plan.destination.x, y: plan.destination.y });
		}
	}

	if (!all_points.length) return null;

	// Last point = destination; everything before = route (intermediate points)
	const destination = all_points[all_points.length - 1];
	const route_points = all_points.slice(0, -1).map((pt) => ({
		x: Math.round((pt.x / grid_size) * 100) / 100,
		y: Math.round((pt.y / grid_size) * 100) / 100,
	}));

	return {
		id: `wp_${now}`,
		label: "",
		x: Math.round((destination.x / grid_size) * 100) / 100,
		y: Math.round((destination.y / grid_size) * 100) / 100,
		time: "12:00",
		face_direction: null,
		linger_minutes: 0,
		scene_id: null,
		arrival_lines: [],
		ambient_lines: [],
		region_radius: default_radius,
		route: route_points,
	};
}