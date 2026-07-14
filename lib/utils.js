/**
 * utils.js — Shared utility functions for BT engine, pathfinding, and nodes.
 *
 * Extracted from patrol_engine.js and created new for Phase 4.
 */

/**
 * Convert a unixtime (epoch ms, UTC) to campaign-local time components.
 * The DC system stores unixtime as a UTC epoch and converts to campaign
 * solar time using longitude: offset = round(lng / 15 * 60) minutes.
 */
export function _to_campaign_components(unixtime) {
	const lng = game.settings.get("Deadlands-Classic", "campaign_lng");
	const off = Math.round(lng / 15 * 60) * 60000; // minutes → ms
	const s = new Date(unixtime + off);
	return {
		year: s.getUTCFullYear(),
		month: s.getUTCMonth(),
		day: s.getUTCDate(),
		hour: s.getUTCHours(),
		minute: s.getUTCMinutes(),
		weekday: s.getUTCDay(), // 0=Sun..6=Sat
	};
}

/**
 * Convert unixtime to campaign-local minutes (HH*60 + MM).
 */
export function _unix_to_minutes(unixtime) {
	const c = _to_campaign_components(unixtime);
	return c.hour * 60 + c.minute;
}

/**
 * Parse a time string "HH:MM" into minutes.
 * @param {string} time_str
 * @returns {number}
 */
export function _parse_time(time_str) {
	if (!time_str) return 0;
	const [h, m] = time_str.split(":").map(Number);
	return (h || 0) * 60 + (m || 0);
}

/**
 * Check if the campaign day changed between two unixtimes.
 */
export function _day_changed(old_ut, new_ut) {
	const o = _to_campaign_components(old_ut);
	const n = _to_campaign_components(new_ut);
	return (n.year !== o.year) || (n.month !== o.month) || (n.day !== o.day);
}

/**
 * Rasterize a wall into a grid, marking blocked cells.
 * Uses Bresenham's line algorithm to trace the wall.
 *
 * @param {Uint8Array} grid  — grid array (1 = blocked)
 * @param {number} gw       — grid width
 * @param {number} gh       — grid height
 * @param {Array} wall_c    — wall coordinates [x1,y1,x2,y2] in pixel space
 * @param {number} cell_size — size of each grid cell in pixels
 */
export function _rasterize_wall(grid, gw, gh, wall_c, cell_size) {
	if (!wall_c || wall_c.length < 4) return;
	const [x1, y1, x2, y2] = wall_c;

	// Convert pixel coordinates to grid coordinates
	let gx1 = Math.floor(x1 / cell_size);
	let gy1 = Math.floor(y1 / cell_size);
	let gx2 = Math.floor(x2 / cell_size);
	let gy2 = Math.floor(y2 / cell_size);

	// Bresenham's line algorithm
	const dx = Math.abs(gx2 - gx1);
	const dy = Math.abs(gy2 - gy1);
	const sx = gx1 < gx2 ? 1 : -1;
	const sy = gy1 < gy2 ? 1 : -1;
	let err = dx - dy;

	while (true) {
		// Mark cell and its neighbors (walls have thickness)
		for (const [ox, oy] of [[0,0], [1,0], [0,1], [1,1]]) {
			const mx = gx1 + ox;
			const my = gy1 + oy;
			if (mx >= 0 && mx < gw && my >= 0 && my < gh) {
				grid[my * gw + mx] = 1;
			}
		}
		if (gx1 === gx2 && gy1 === gy2) break;
		const e2 = 2 * err;
		if (e2 > -dy) { err -= dy; gx1 += sx; }
		if (e2 < dx) { err += dx; gy1 += sy; }
	}
}

/**
 * Get all grid cells inside a region.
 *
 * @param {RegionDocument} region
 * @param {number} gw        — grid width
 * @param {number} gh        — grid height
 * @param {number} cell_size — grid cell size in pixels
 * @returns {Array<{x: number, y: number}>}
 */
export function _get_region_cells(region, gw, gh, cell_size) {
	// Foundry regions have a .polygon or we can test points
	// Use the region's shape to determine which cells it covers
	const cells = [];
	const shape = region._source?.shape;

	if (!shape) {
		// Fallback: test each cell center against region
		return _cells_in_polygon(region, gw, gh, cell_size);
	}

	// Foundry V14 regions use shape types: circle, ellipse, polygon
	const shape_type = shape.type;

	if (shape_type === "circle") {
		const cx = shape.x / cell_size;
		const cy = shape.y / cell_size;
		const r = shape.radius / cell_size;
		for (let y = 0; y < gh; y++) {
			for (let x = 0; x < gw; x++) {
				const dx = x + 0.5 - cx;
				const dy = y + 0.5 - cy;
				if (dx * dx + dy * dy <= r * r) {
					cells.push({ x, y });
				}
			}
		}
	} else if (shape_type === "ellipse") {
		const cx = shape.x / cell_size;
		const cy = shape.y / cell_size;
		const rx = shape.radiusX / cell_size;
		const ry = shape.radiusY / cell_size;
		for (let y = 0; y < gh; y++) {
			for (let x = 0; x < gw; x++) {
				const dx = (x + 0.5 - cx) / rx;
				const dy = (y + 0.5 - cy) / ry;
				if (dx * dx + dy * dy <= 1) {
					cells.push({ x, y });
				}
			}
		}
	} else if (shape_type === "polygon") {
		// Shape.points is a flat array [x1,y1,x2,y2,...] in pixel coords
		const poly_points = shape.points;
		if (poly_points && poly_points.length >= 6) {
			// Convert to grid coordinates
			const grid_poly = poly_points.map((v, i) =>
				i % 2 === 0 ? v / cell_size : v / cell_size
			);
			for (let y = 0; y < gh; y++) {
				for (let x = 0; x < gw; x++) {
					if (_point_in_polygon(x + 0.5, y + 0.5, grid_poly)) {
						cells.push({ x, y });
					}
				}
			}
		}
	} else {
		// Unknown shape type — fallback to testing
		return _cells_in_polygon(region, gw, gh, cell_size);
	}

	return cells;
}

/**
 * Fallback: test each cell center against the region's polygon using
 * Foundry's region containsPoint API if available.
 */
function _cells_in_polygon(region, gw, gh, cell_size) {
	const cells = [];
	for (let y = 0; y < gh; y++) {
		for (let x = 0; x < gw; x++) {
			const px = (x + 0.5) * cell_size;
			const py = (y + 0.5) * cell_size;
			try {
				if (region.containsPoint?.(px, py) ?? false) {
					cells.push({ x, y });
				}
			} catch {
				// If containsPoint isn't available, skip
			}
		}
	}
	return cells;
}

/**
 * Point-in-polygon test using ray casting.
 * @param {number} px — point x
 * @param {number} py — point y
 * @param {number[]} poly — flat polygon [x1,y1,x2,y2,...]
 * @returns {boolean}
 */
export function _point_in_polygon(px, py, poly) {
	let inside = false;
	const n = poly.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = poly[i * 2], yi = poly[i * 2 + 1];
		const xj = poly[j * 2], yj = poly[j * 2 + 1];
		if (((yi > py) !== (yj > py)) &&
			(px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
			inside = !inside;
		}
	}
	return inside;
}

/**
 * Evaluate a flag value against an operator and expected value.
 * Shared between flag_condition boon and condition_flag BT node.
 *
 * @param {*} actual
 * @param {string} operator — exists, not_exists, equals, not_equals, greater,
 *                            less, greater_eq, less_eq, contains, starts_with
 * @param {*} expected
 * @returns {boolean}
 */
export function _evaluate_operator(actual, operator, expected) {
	switch (operator) {
		case 'exists':       return actual !== undefined && actual !== null;
		case 'not_exists':   return actual === undefined || actual === null;
		case 'equals':       return actual == expected;
		case 'not_equals':   return actual != expected;
		case 'greater':      return Number(actual) > Number(expected);
		case 'less':         return Number(actual) < Number(expected);
		case 'greater_eq':   return Number(actual) >= Number(expected);
		case 'less_eq':      return Number(actual) <= Number(expected);
		case 'contains':     return String(actual ?? '').includes(String(expected));
		case 'starts_with':  return String(actual ?? '').startsWith(String(expected));
		default:             return false;
	}
}

/**
 * Fill placeholders in a text string with blackboard values.
 * Supports {name}, {actor_name}, {time}, {weekday}
 * @param {string} text
 * @param {Object} bb — blackboard
 * @returns {string}
 */
export function _fill_placeholders(text, bb) {
	return text
		.replace(/\{name\}/gi, bb.token?.name || bb.actor?.name || "Unknown")
		.replace(/\{actor_name\}/gi, bb.actor?.name || "Unknown")
		.replace(/\{time\}/gi, () => {
			const m = bb.current_minutes || 0;
			const h = Math.floor(m / 60);
			const min = m % 60;
			return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
		})
		.replace(/\{weekday\}/gi, () => {
			const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
			return days[bb.weekday ?? 0] || "Unknown";
		});
}

/**
 * Find a waypoint by its label in the actor's paths.
 * @param {Object} bb — blackboard
 * @param {string} label — waypoint label to search for
 * @returns {Object|null}
 */
export function _find_waypoint_by_label(bb, label) {
	if (!label) return null;
	const paths = bb.actor.getFlag("dc-npc-patrols", "paths") || [];
	for (const path of paths) {
		if (!path.enabled) continue;
		const wp = path.waypoints.find(w => w.label === label);
		if (wp) return wp;
	}
	// Search disabled paths too as fallback
	for (const path of paths) {
		const wp = path.waypoints.find(w => w.label === label);
		if (wp) return wp;
	}
	return null;
}

/**
 * Find due waypoints whose time falls between old_minutes and new_minutes.
 * Extracted from PatrolEngine._find_due_waypoints for BT reuse.
 *
 * @param {Object} path — patrol path with waypoints array
 * @param {number} old_minutes — previous time in minutes
 * @param {number} new_minutes — current time in minutes
 * @param {boolean} day_changed — whether midnight was crossed
 * @returns {Array} due waypoints sorted chronologically
 */
export function _find_due_waypoints(path, old_minutes, new_minutes, day_changed) {
	const due = [];
	for (const wp of path.waypoints) {
		if (!wp.time) continue;
		const [h, m] = wp.time.split(":").map(Number);
		const wp_minutes = h * 60 + m;

		if (day_changed) {
			// Midnight rollover: check if wp time is after old OR before new
			if (wp_minutes >= old_minutes || wp_minutes <= new_minutes) {
				due.push(wp);
			}
		} else {
			// Same day: wp time must be between old and new
			if (wp_minutes > old_minutes && wp_minutes <= new_minutes) {
				due.push(wp);
			}
		}
	}
	// Sort chronologically by minutes
	due.sort((a, b) => {
		const [ah, am] = a.time.split(":").map(Number);
		const [bh, bm] = b.time.split(":").map(Number);
		return (ah * 60 + am) - (bh * 60 + bm);
	});
	return due;
}