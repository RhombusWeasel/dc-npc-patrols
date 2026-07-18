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
 * Normalized edge key between two adjacent nav cells.
 */
export function edge_key(x1, y1, x2, y2) {
	let a, b;
	if (x1 < x2 || (x1 === x2 && y1 <= y2)) {
		a = `${x1},${y1}`;
		b = `${x2},${y2}`;
	} else {
		a = `${x2},${y2}`;
		b = `${x1},${y1}`;
	}
	return `${a}>${b}`;
}

/**
 * Invoke callback for each nav-cell edge along a wall segment.
 */
export function for_each_wall_edge(gw, gh, wall_c, cell_size, callback) {
	if (!wall_c || wall_c.length < 4) return;
	const [px1, py1, px2, py2] = wall_c;
	if (px1 === px2 && py1 === py2) return;

	const adx = Math.abs(px2 - px1);
	const ady = Math.abs(py2 - py1);
	const max_d = Math.max(adx, ady);
	const axis_threshold = 0.087;
	const is_axis_aligned = max_d > 0 && Math.min(adx, ady) / max_d < axis_threshold;

	if (is_axis_aligned) {
		_for_each_axis_aligned_edge(gw, gh, px1, py1, px2, py2, cell_size, callback);
	} else {
		_for_each_diagonal_edge(gw, gh, px1, py1, px2, py2, cell_size, callback);
	}
}

export function _rasterize_wall(blocked_edges, gw, gh, wall_c, cell_size) {
	for_each_wall_edge(gw, gh, wall_c, cell_size, (x1, y1, x2, y2) => {
		block_edge(blocked_edges, x1, y1, x2, y2);
	});
}

function _for_each_axis_aligned_edge(gw, gh, px1, py1, px2, py2, cell_size, callback) {
	const adx = Math.abs(px2 - px1);
	const ady = Math.abs(py2 - py1);

	if (adx >= ady) {
		const wall_y = (py1 + py2) / 2;
		const row = Math.floor(wall_y / cell_size);
		const row_top_px = row * cell_size;
		const row_bot_px = (row + 1) * cell_size;
		const edge_row = (Math.abs(wall_y - row_top_px) <= Math.abs(wall_y - row_bot_px)) ? row : row + 1;
		const a = edge_row - 1;
		const b = edge_row;
		if (a < 0 || b >= gh) return;

		const x_lo = Math.min(px1, px2);
		const x_hi = Math.max(px1, px2);
		const c_start = Math.floor(x_lo / cell_size);
		const c_end = Math.floor(x_hi / cell_size);
		for (let cx = c_start; cx <= c_end; cx++) {
			if (cx >= 0 && cx < gw) callback(cx, a, cx, b);
		}
	} else {
		const wall_x = (px1 + px2) / 2;
		const col = Math.floor(wall_x / cell_size);
		const col_left_px = col * cell_size;
		const col_right_px = (col + 1) * cell_size;
		const edge_col = (Math.abs(wall_x - col_left_px) <= Math.abs(wall_x - col_right_px)) ? col : col + 1;
		const a = edge_col - 1;
		const b = edge_col;
		if (a < 0 || b >= gw) return;

		const y_lo = Math.min(py1, py2);
		const y_hi = Math.max(py1, py2);
		const c_start = Math.floor(y_lo / cell_size);
		const c_end = Math.floor(y_hi / cell_size);
		for (let cy = c_start; cy <= c_end; cy++) {
			if (cy >= 0 && cy < gh) callback(a, cy, b, cy);
		}
	}
}

function _for_each_diagonal_edge(gw, gh, px1, py1, px2, py2, cell_size, callback) {
	const dx = px2 - px1;
	const dy = py2 - py1;
	const step_x = dx > 0 ? 1 : dx < 0 ? -1 : 0;
	const step_y = dy > 0 ? 1 : dy < 0 ? -1 : 0;

	let cx = Math.floor(px1 / cell_size);
	let cy = Math.floor(py1 / cell_size);

	let t_max_x, t_max_y, t_delta_x, t_delta_y;
	if (step_x > 0) {
		t_max_x = ((cx + 1) * cell_size - px1) / dx;
		t_delta_x = cell_size / dx;
	} else if (step_x < 0) {
		t_max_x = (cx * cell_size - px1) / dx;
		t_delta_x = cell_size / -dx;
	} else {
		t_max_x = Infinity;
		t_delta_x = Infinity;
	}
	if (step_y > 0) {
		t_max_y = ((cy + 1) * cell_size - py1) / dy;
		t_delta_y = cell_size / dy;
	} else if (step_y < 0) {
		t_max_y = (cy * cell_size - py1) / dy;
		t_delta_y = cell_size / -dy;
	} else {
		t_max_y = Infinity;
		t_delta_y = Infinity;
	}

	const EPS = 1e-10;
	const wall_cells = [];
	while (true) {
		wall_cells.push([cx, cy]);
		if (t_max_x < t_max_y - EPS) {
			if (t_max_x > 1) break;
			cx += step_x;
			t_max_x += t_delta_x;
		} else if (t_max_y < t_max_x - EPS) {
			if (t_max_y > 1) break;
			cy += step_y;
			t_max_y += t_delta_y;
		} else {
			if (t_max_x > 1) break;
			cx += step_x;
			cy += step_y;
			t_max_x += t_delta_x;
			t_max_y += t_delta_y;
		}
	}

	const side = (x, y) => (x - px1) * dy - (y - py1) * dx;
	for (const [wx, wy] of wall_cells) {
		const wc_sign = Math.sign(side((wx + 0.5) * cell_size, (wy + 0.5) * cell_size));
		for (const [ndx, ndy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
			const nx = wx + ndx;
			const ny = wy + ndy;
			if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
			const nc_sign = Math.sign(side((nx + 0.5) * cell_size, (ny + 0.5) * cell_size));
			if (wc_sign !== nc_sign) callback(wx, wy, nx, ny);
		}
	}
}

/**
 * Add a blocked edge between two adjacent cells to the set.
 */
export function block_edge(blocked_edges, x1, y1, x2, y2) {
	blocked_edges.add(edge_key(x1, y1, x2, y2));
}

/**
 * Check if the edge between two adjacent cells is blocked.
 * @param {Set<string>} blocked_edges
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {boolean}
 */
export function _is_edge_blocked(blocked_edges, x1, y1, x2, y2) {
	return blocked_edges.has(edge_key(x1, y1, x2, y2));
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
	const cells = [];

	// Strategy 1: Try polygonTree.testPoint() (preferred — handles all shape types)
	// Use a fresh point object each call to avoid mutation issues.
	let polygon_tree_ok = false;
	try {
		if (region.polygonTree?.testPoint) {
			// Quick probe — test a single point to see if the API works
			const probe = { x: (0.5) * cell_size, y: (0.5) * cell_size };
			region.polygonTree.testPoint(probe);
			polygon_tree_ok = true;
		}
	} catch {
		// polygonTree not ready (canvas not initialized)
	}

	if (polygon_tree_ok) {
		for (let y = 0; y < gh; y++) {
			for (let x = 0; x < gw; x++) {
				const pt = { x: (x + 0.5) * cell_size, y: (y + 0.5) * cell_size };
				try {
					if (region.polygonTree.testPoint(pt)) {
						cells.push({ x, y });
					}
				} catch {
					// skip individual cell errors
				}
			}
		}
		if (cells.length > 0) return cells;
	}

	// Strategy 2: Geometric fallback — test points against raw shape data
	// This works without the canvas being fully initialized.
	const shapes = region.shapes ?? region._source?.shapes ?? [];
	if (!shapes.length) return cells;

	// Normalize shapes to plain objects for reliable property access
	// Foundry DataModel instances may not expose properties via Object.keys()
	const norm_shapes = shapes.map(s => {
		if (s.toObject) return s.toObject();
		return s;
	});

	// Compute bounding box of all shapes for efficient iteration
	let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
	for (const shape of norm_shapes) {
		const b = _shape_bounds(shape);
		min_x = Math.min(min_x, b.x);
		min_y = Math.min(min_y, b.y);
		max_x = Math.max(max_x, b.x + b.w);
		max_y = Math.max(max_y, b.y + b.h);
	}

	// Only iterate cells within the bounding box
	const start_x = Math.max(0, Math.floor(min_x / cell_size));
	const end_x = Math.min(gw - 1, Math.ceil(max_x / cell_size));
	const start_y = Math.max(0, Math.floor(min_y / cell_size));
	const end_y = Math.min(gh - 1, Math.ceil(max_y / cell_size));

	for (let y = start_y; y <= end_y; y++) {
		for (let x = start_x; x <= end_x; x++) {
			const px = (x + 0.5) * cell_size;
			const py = (y + 0.5) * cell_size;
			if (_point_in_shapes(px, py, norm_shapes)) {
				cells.push({ x, y });
			}
		}
	}
	return cells;
}

/**
 * Get the bounding box of a single shape.
 * @param {object} shape — Foundry region shape data
 * @returns {{x: number, y: number, w: number, h: number}}
 */
function _shape_bounds(shape) {
	switch (shape.type) {
		case 'circle':
			return { x: shape.x - shape.radius, y: shape.y - shape.radius, w: shape.radius * 2, h: shape.radius * 2 };
		case 'ellipse':
			return { x: shape.x - shape.radiusX, y: shape.y - shape.radiusY, w: shape.radiusX * 2, h: shape.radiusY * 2 };
		case 'rectangle':
			return { x: shape.x, y: shape.y, w: shape.width, h: shape.height };
		case 'polygon': {
			const pts = shape.points ?? [];
			if (!pts.length) return { x: 0, y: 0, w: 0, h: 0 };
			let min_x = pts[0], min_y = pts[1], max_x = pts[0], max_y = pts[1];
			for (let i = 2; i < pts.length; i += 2) {
				min_x = Math.min(min_x, pts[i]);
				max_x = Math.max(max_x, pts[i]);
				min_y = Math.min(min_y, pts[i + 1]);
				max_y = Math.max(max_y, pts[i + 1]);
			}
			return { x: min_x, y: min_y, w: max_x - min_x, h: max_y - min_y };
		}
		default:
			return { x: 0, y: 0, w: 0, h: 0 };
	}
}

/**
 * Test whether a point is inside any of the region's shapes.
 * @param {number} px — point x (pixels)
 * @param {number} py — point y (pixels)
 * @param {Array} shapes — region shape data array
 * @returns {boolean}
 */
function _point_in_shapes(px, py, shapes) {
	// First check if point is inside any solid (non-hole) shape
	let in_solid = false;
	for (const shape of shapes) {
		if (shape.hole) continue;
		if (_point_in_shape(px, py, shape)) { in_solid = true; break; }
	}
	if (!in_solid) return false;
	// Then check if point is inside any hole — if so, it's not in the region
	for (const shape of shapes) {
		if (!shape.hole) continue;
		if (_point_in_shape(px, py, shape)) return false;
	}
	return true;
}

/**
 * Test whether a point is inside a single shape.
 * @param {number} px — point x (pixels)
 * @param {number} py — point y (pixels)
 * @param {object} shape — Foundry region shape data
 * @returns {boolean}
 */
function _point_in_shape(px, py, shape) {
	switch (shape.type) {
		case 'circle': {
			const dx = px - shape.x;
			const dy = py - shape.y;
			return (dx * dx + dy * dy) <= (shape.radius * shape.radius);
		}
		case 'ellipse': {
			const dx = (px - shape.x) / shape.radiusX;
			const dy = (py - shape.y) / shape.radiusY;
			return (dx * dx + dy * dy) <= 1;
		}
		case 'rectangle':
			return px >= shape.x && px <= shape.x + shape.width &&
				py >= shape.y && py <= shape.y + shape.height;
		case 'polygon': {
			const pts = shape.points ?? [];
			if (pts.length < 6) return false; // need at least 3 points
			return _point_in_polygon_flat(px, py, pts);
		}
		default:
			return false;
	}
}

/**
 * Point-in-polygon test using ray casting on a flat points array.
 * @param {number} px — point x
 * @param {number} py — point y
 * @param {number[]} pts — flat array [x1,y1,x2,y2,...]
 * @returns {boolean}
 */
function _point_in_polygon_flat(px, py, pts) {
	let inside = false;
	const n = pts.length / 2;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const xi = pts[i * 2], yi = pts[i * 2 + 1];
		const xj = pts[j * 2], yj = pts[j * 2 + 1];
		if (((yi > py) !== (yj > py)) &&
			(px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
			inside = !inside;
		}
	}
	return inside;
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
 * Check if a grid tile (in pixel coordinates) contains a region with a
 * changeLevel behavior — i.e. a stairs tile.
 *
 * @param {Scene} scene   — the scene to search
 * @param {number} px     — pixel x (top-left of tile, or any point inside)
 * @param {number} py     — pixel y
 * @param {number} grid   — grid size in pixels (optional, defaults to scene.grid.size)
 * @returns {RegionDocument|null} the changeLevel region at this tile, or null
 */
export function _tile_has_change_level(scene, px, py, grid) {
	grid ??= scene.grid.size;
	const tile_center_x = px + grid / 2;
	const tile_center_y = py + grid / 2;
	for (const region of scene.regions) {
		const has_cl = region.behaviors.some(b => b.type === "changeLevel");
		if (!has_cl) continue;
		// Use polygonTree if available (canvas initialised), else geometric fallback
		let inside = false;
		try {
			if (region.polygonTree?.testPoint) {
				inside = region.polygonTree.testPoint({ x: tile_center_x, y: tile_center_y });
			}
		} catch { /* fall through to geometric */ }
		if (!inside) {
			const shapes = region.shapes ?? region._source?.shapes ?? [];
			const norm = shapes.map(s => s.toObject ? s.toObject() : s);
			inside = _point_in_shapes(tile_center_x, tile_center_y, norm);
		}
		if (inside) return region;
	}
	return null;
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
 * Resolve {{var}} placeholders in a string against a variables map.
 *
 * If the entire string is a single {{var}} reference, the raw variable value
 * is returned (preserving its original type — e.g. number stays number).
 * If the string contains mixed text or multiple placeholders, string
 * substitution is used and the result is always a string.
 *
 * @param {string} text — the string to resolve
 * @param {Object} variables — map of variable key → value
 * @returns {*}
 */
export function _resolve_variables(text, variables) {
	if (typeof text !== 'string' || !text.includes('{{')) return text;
	variables = variables || {};

	// Single {{var}} — return raw value to preserve type
	const single = text.match(/^\{\{(\w+)\}\}$/);
	if (single) {
		const key = single[1];
		if (!Object.prototype.hasOwnProperty.call(variables, key)) return text;
		const val = variables[key];
		return val !== undefined && val !== null && val !== '' ? val : '';
	}

	// Mixed text — string substitution
	return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
		if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
		const val = variables[key];
		return val !== undefined && val !== null && val !== '' ? String(val) : '';
	});
}

/** True when a string still contains an unresolved {{var}} placeholder. */
export function _has_unresolved_variables(text) {
	return typeof text === 'string' && /\{\{\w+\}\}/.test(text);
}

/**
 * Recursively resolve {{var}} placeholders in any value type.
 * Strings are resolved; arrays and plain objects are deep-resolved;
 * primitives pass through unchanged.
 *
 * @param {*} val
 * @param {Object} variables — map of variable key → value
 * @returns {*}
 */
export function _resolve_value(val, variables) {
	if (typeof val === 'string') return _resolve_variables(val, variables);
	if (Array.isArray(val)) return val.map(v => _resolve_value(v, variables));
	if (val !== null && typeof val === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(val)) out[k] = _resolve_value(v, variables);
		return out;
	}
	return val;
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

/**
 * Compute token rotation (degrees) to face travel between two pixel positions.
 * Matches Foundry V14 TokenDocument.#rotateInMovementDirection.
 *
 * @param {number} from_x
 * @param {number} from_y
 * @param {number} to_x
 * @param {number} to_y
 * @returns {number|null}
 */
export function _travel_rotation(from_x, from_y, to_x, to_y) {
	if (from_x === to_x && from_y === to_y) return null;
	const ray = new foundry.canvas.geometry.Ray({ x: from_x, y: from_y }, { x: to_x, y: to_y });
	if (ray.distance <= 0) return null;
	return Math.normalizeDegrees(Math.toDegrees(ray.angle) - 90);
}

/** Default options for programmatic token moves — face travel direction. */
export const TOKEN_MOVE_OPTS = { autoRotate: true };

/**
 * Animate and persist a token moving to a pixel destination, facing travel direction.
 *
 * @param {TokenDocument} token_doc
 * @param {number} to_x
 * @param {number} to_y
 */
export async function _animate_token_travel(token_doc, to_x, to_y) {
	const token = token_doc.object;
	if (!token) return;

	const rotation = _travel_rotation(token.x, token.y, to_x, to_y);
	const anim = { x: to_x, y: to_y };
	if (rotation != null) anim.rotation = rotation;
	await token.animate(anim);

	const upd = { x: to_x, y: to_y };
	if (rotation != null) upd.rotation = rotation;
	await token_doc.update(upd);
}