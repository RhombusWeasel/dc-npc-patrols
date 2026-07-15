/**
 * path_debug_overlay.js — Visual debug overlay for the pathfinding system.
 *
 * Renders what the pathfinder "sees" directly on the canvas:
 *   - Red lines:   blocked edges (walls the pathfinder won't cross)
 *   - Green grid:  nav-cell subdivision (only when nav_resolution > 1)
 *   - Blue squares: stairs cells (level transitions)
 *   - Yellow line:  most recent A* path with waypoint dots
 *
 * Toggle via the scene control tool button or Alt+Shift+P.
 * Also accessible at window.dcNpcPatrols.path_debug for console access.
 */

export class PathDebugOverlay {
	/**
	 * @param {object} pathfinding — Pathfinding instance
	 */
	constructor(pathfinding) {
		this._pathfinding = pathfinding;
		this._active = false;
		this._graphics = null;
		this._last_path = null;
	}

	/** Toggle the overlay on/off */
	toggle() {
		if (this._active) this.disable();
		else this.enable();
	}

	/** Enable the overlay — creates PIXI.Graphics and renders */
	enable() {
		if (this._active) return;
		if (!canvas?.ready) return;
		this._active = true;
		this._render();
		console.log("[dc-npc-patrols] Path debug overlay enabled.");
	}

	/** Disable the overlay — destroys PIXI.Graphics */
	disable() {
		if (!this._active) return;
		this._active = false;
		if (this._graphics) {
			this._graphics.destroy({ children: true });
			this._graphics = null;
		}
		console.log("[dc-npc-patrols] Path debug overlay disabled.");
	}

	/** Store the last computed path for rendering */
	set_last_path(path) {
		this._last_path = path;
		if (this._active) this._render();
	}

	/** Clear the last path (e.g. on scene change) */
	clear_path() {
		this._last_path = null;
		if (this._active) this._render();
	}

	/** Render the overlay */
	_render() {
		if (!this._active) return;
		if (!canvas?.ready) return;

		// Destroy old graphics
		if (this._graphics) {
			this._graphics.destroy({ children: true });
			this._graphics = null;
		}

		const scene = canvas.scene;
		if (!scene) return;

		const grid_data = this._pathfinding._get_or_build_grid(scene);
		if (!grid_data) return;

		const gfx = new PIXI.Graphics();
		this._graphics = gfx;

		const { grids, stairs_cells, gw, gh, cell_size, nav_resolution } = grid_data;

		// Determine the currently viewed level so we only draw walls/stairs/path
		// for the level the viewer is actually looking at.
		const current_level = canvas.level?.id ?? '_default';

		// ── 1. Nav grid (faint green) — only when subdivided ──
		if (nav_resolution > 1) {
			gfx.lineStyle(0.5, 0x00ff00, 0.15);
			for (let x = 0; x <= gw; x++) {
				gfx.moveTo(x * cell_size, 0);
				gfx.lineTo(x * cell_size, gh * cell_size);
			}
			for (let y = 0; y <= gh; y++) {
				gfx.moveTo(0, y * cell_size);
				gfx.lineTo(gw * cell_size, y * cell_size);
			}
		}

		// ── 2. Grid square boundaries (slightly brighter green) ──
		const gs = scene.grid.size;
		const sq_w = Math.ceil(gw * cell_size / gs);
		const sq_h = Math.ceil(gh * cell_size / gs);
		gfx.lineStyle(1, 0x00ff00, 0.25);
		for (let x = 0; x <= sq_w; x++) {
			gfx.moveTo(x * gs, 0);
			gfx.lineTo(x * gs, sq_h * gs);
		}
		for (let y = 0; y <= sq_h; y++) {
			gfx.moveTo(0, y * gs);
			gfx.lineTo(sq_w * gs, y * gs);
		}

		// ── 3. Blocked edges (red) — current level only ──
		gfx.lineStyle(2, 0xff0000, 0.7);
		{
			const blocked_edges = grids[current_level] ?? grids['_default'] ?? [];
			for (const edge_key of blocked_edges) {
				// Edge key format: "x1,y1>x2,y2"
				const [a, b] = edge_key.split('>');
				const [ax, ay] = a.split(',').map(Number);
				const [bx, by] = b.split(',').map(Number);

				if (ax === bx) {
					// Vertical edge — horizontal line segment at the boundary
					const x_px = ax * cell_size;
					const y_px = Math.max(ay, by) * cell_size;
					gfx.moveTo(x_px, y_px);
					gfx.lineTo(x_px + cell_size, y_px);
				} else {
					// Horizontal edge — vertical line segment at the boundary
					const x_px = Math.max(ax, bx) * cell_size;
					const y_px = ay * cell_size;
					gfx.moveTo(x_px, y_px);
					gfx.lineTo(x_px, y_px + cell_size);
				}
			}
		}

		// ── 4. Stairs cells (blue squares) — current level only ──
		if (stairs_cells && stairs_cells.size > 0) {
			gfx.lineStyle(1, 0x0066ff, 0.5);
			gfx.beginFill(0x0066ff, 0.3);
			for (const key of stairs_cells.keys()) {
				const parts = key.split(',');
				if (parts[2] !== current_level) continue;
				const sx = parseInt(parts[0]);
				const sy = parseInt(parts[1]);
				gfx.drawRect(sx * cell_size + 2, sy * cell_size + 2, cell_size - 4, cell_size - 4);
			}
			gfx.endFill();
		}

		// ── 5. Last path (yellow) — current level only ──
		// Offset by half a tile so the path renders in tile centres,
		// matching how tokens occupy the top-left of their tile.
		if (this._last_path && this._last_path.length > 1) {
			const half = gs / 2;

			// Filter to waypoints on the current level. If a path crosses
			// levels via stairs, only the segment(s) on this level are drawn.
			const pts = this._last_path.filter(wp => (wp.level_id ?? '_default') === current_level);

			if (pts.length > 1) {
				// Line through waypoints
				gfx.lineStyle(3, 0xffff00, 0.8);
				gfx.moveTo(pts[0].x * gs + half, pts[0].y * gs + half);
				for (let i = 1; i < pts.length; i++) {
					gfx.lineTo(pts[i].x * gs + half, pts[i].y * gs + half);
				}

				// Waypoint dots
				gfx.lineStyle(0);
				gfx.beginFill(0xffff00, 1);
				for (const wp of pts) {
					gfx.drawCircle(wp.x * gs + half, wp.y * gs + half, 4);
				}
				gfx.endFill();
			}
		}

		// Add to stage above tokens but below UI
		canvas.stage.addChild(gfx);
	}
}