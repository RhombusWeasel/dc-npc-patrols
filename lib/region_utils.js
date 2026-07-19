/**
 * region_utils.js — Scene region lookup helpers (nearest match, any-match).
 */

import { _get_region_cells } from "./utils.js";

function _grid_metrics(scene, cell_size) {
	const grid = scene.grid?.size ?? cell_size;
	const gw = Math.ceil(scene.width / grid);
	const gh = Math.ceil(scene.height / grid);
	return { grid, gw, gh };
}

export function find_regions_by_name(scene, name) {
	if (!scene || !name) return [];
	const trimmed = String(name).trim();
	if (!trimmed) return [];
	return scene.regions.filter((r) => r.name === trimmed);
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
		const dist = distance_px_to_region(source_xy, region, scene, size);
		if (dist < best_dist) {
			best_dist = dist;
			best = region;
		}
	}
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
