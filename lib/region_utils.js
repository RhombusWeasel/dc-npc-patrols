/**
 * region_utils.js — Scene region lookup helpers (nearest match, any-match).
 */

import { _get_region_cells } from "./utils.js";
import { bt_debug_enabled, bt_log } from "./bt_debug.js";

function _grid_metrics(scene, cell_size) {
	const grid = scene.grid?.size ?? cell_size;
	// Use scene.dimensions which includes padding, matching pathfinding._get_or_build_grid
	// Regions and tokens can be positioned in the padded area beyond scene.width/height
	const scene_w = scene.dimensions?.width ?? scene.width;
	const scene_h = scene.dimensions?.height ?? scene.height;
	const gw = Math.ceil(scene_w / grid);
	const gh = Math.ceil(scene_h / grid);
	return { grid, gw, gh };
}

export function find_regions_by_name(scene, name) {
	if (!scene || !name) return [];
	const trimmed = String(name).trim();
	if (!trimmed) return [];
	const matches = scene.regions.filter((r) => r.name === trimmed);
	if (!matches.length) {
		bt_log(
			"region.lookup",
			`no exact match for "${trimmed}" in ${scene.regions.size} regions: ` +
				scene.regions.map((r) => `"${r.name}"`).join(", "),
		);
	}
	return matches;
}

export function get_region_cells_for_scene(region, scene, cell_size) {
	if (!region || !scene) return [];
	const { gw, gh } = _grid_metrics(scene, cell_size);
	return _get_region_cells(region, gw, gh, cell_size);
}

export function distance_px_to_region(source_xy, region, scene, cell_size) {
	const cells = get_region_cells_for_scene(region, scene, cell_size);
	if (!cells.length) return Infinity;

	let best = Infinity;
	for (const cell of cells) {
		const cx = (cell.x + 0.5) * cell_size;
		const cy = (cell.y + 0.5) * cell_size;
		const dist = Math.hypot(source_xy.x - cx, source_xy.y - cy);
		if (dist < best) best = dist;
	}
	return best;
}

export function region_centroid_px(region, scene, cell_size) {
	const cells = get_region_cells_for_scene(region, scene, cell_size);
	if (!cells.length) return null;

	let sx = 0;
	let sy = 0;
	for (const cell of cells) {
		sx += (cell.x + 0.5) * cell_size;
		sy += (cell.y + 0.5) * cell_size;
	}
	const n = cells.length;
	return { x: sx / n, y: sy / n };
}

export function find_nearest_region(scene, name, source_xy, cell_size = null) {
	const matches = find_regions_by_name(scene, name);
	if (!matches.length || !source_xy) return null;

	const size = cell_size ?? scene.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
	let best = null;
	let best_dist = Infinity;

	for (const region of matches) {
		const cells = get_region_cells_for_scene(region, scene, size);
		const dist = distance_px_to_region(source_xy, region, scene, size);
		if (bt_debug_enabled()) bt_log("region.nearest", `region="${region.name}" id=${region.id} cells=${cells.length} dist=${dist}`);
		if (dist < best_dist) {
			best_dist = dist;
			best = region;
		}
	}
	if (!best && bt_debug_enabled()) bt_log("region.nearest", `all matches returned Infinity — region shape may be empty or on a different level`);
	return best;
}

export function token_in_any_named_region(token_doc, scene, name, cell_size = null) {
	if (!token_doc || !scene || !name) return false;

	const grid = cell_size ?? scene.grid?.size ?? 100;
	const tx = Math.floor(token_doc.x / grid);
	const ty = Math.floor(token_doc.y / grid);

	for (const region of find_regions_by_name(scene, name)) {
		const cells = get_region_cells_for_scene(region, scene, grid);
		if (cells.some((c) => c.x === tx && c.y === ty)) return true;
	}
	return false;
}
