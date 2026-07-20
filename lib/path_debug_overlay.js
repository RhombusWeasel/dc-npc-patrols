/**
 * path_debug_overlay.js — Visual debug overlay for the pathfinding system.
 *
 * Two independent layers:
 *
 * 1. Structural overlay (gated by the Alt+Shift+P toggle):
 *    - Red lines:   blocked edges (walls the pathfinder won't cross)
 *    - Green grid:  nav-cell subdivision (only when nav_resolution > 1)
 *    - Blue squares: stairs cells (level transitions)
 *
 * 2. Path lines (always on for selected tokens):
 *    - Cyan line: remaining path segments for each selected token with an
 *      active BT move.
 *    - Dim amber: segments on other levels.
 *    - Dots at each remaining waypoint.
 *
 * Toggle the structural layer via the scene control tool button or
 * Alt+Shift+P.  Path lines for selected tokens always render.
 * Also accessible at window.dcNpcPatrols.path_debug for console access.
 */

export class PathDebugOverlay {
	/**
	 * @param {object} pathfinding — Pathfinding instance
	 */
	constructor(pathfinding) {
		this._pathfinding = pathfinding;
		this._bt_engine = null;
		this._active = false;
		this._struct_gfx = null;
		this._path_gfx = null;
	}

	/** Provide the BT engine so the overlay can query remaining paths */
	set_bt_engine(bt_engine) {
		this._bt_engine = bt_engine;
	}

	/** Toggle the structural overlay on/off */
	toggle() {
		if (this._active) this.disable();
		else this.enable();
	}

	/** Enable the structural overlay — creates PIXI.Graphics and renders */
	enable() {
		if (this._active) return;
		if (!canvas?.ready) return;
		this._active = true;
		this._render_struct();
		this._render_paths();
		console.log("[dc-npc-patrols] Path debug overlay enabled.");
	}

	/** Disable the structural overlay — destroys structural graphics only */
	disable() {
		if (!this._active) return;
		this._active = false;
		if (this._struct_gfx) {
			this._struct_gfx.destroy({ children: true });
			this._struct_gfx = null;
		}
		console.log("[dc-npc-patrols] Path debug overlay disabled.");
	}

	// ── Path layer (always on for selected tokens) ──────────────────────

	/**
	 * Re-render the path lines for currently selected tokens.
	 * Call this on token selection changes and on BT tick.
	 */
	render_paths() {
		this._render_paths();
	}

	/** Clear path graphics (e.g. on scene change) */
	clear_paths() {
		if (this._path_gfx) {
			this._path_gfx.destroy({ children: true });
			this._path_gfx = null;
		}
	}

	_render_paths() {
		if (!canvas?.ready) return;

		// Destroy old path graphics
		if (this._path_gfx) {
			this._path_gfx.destroy({ children: true });
			this._path_gfx = null;
		}

		const controlled = canvas.tokens?.controlled ?? [];
		if (controlled.length === 0) return;
		if (!this._bt_engine) return;

		const scene = canvas.scene;
		if (!scene) return;
		const gs = scene.grid.size;
		const half = gs / 2;
		const current_level = canvas.level?.id ?? '_default';

		const gfx = new PIXI.Graphics();
		this._path_gfx = gfx;

		for (const token of controlled) {
			const remaining = this._bt_engine.get_remaining_path(token.id);
			if (!remaining || remaining.length < 2) continue;

			for (let i = 1; i < remaining.length; i++) {
				const a = remaining[i - 1];
				const b = remaining[i];
				const a_on = (a.level_id ?? '_default') === current_level;
				const b_on = (b.level_id ?? '_default') === current_level;

				if (a_on && b_on) {
					gfx.lineStyle(3, 0x00ffff, 0.8);
				} else {
					gfx.lineStyle(2, 0xff9900, 0.4);
				}
				gfx.moveTo(a.x * gs + half, a.y * gs + half);
				gfx.lineTo(b.x * gs + half, b.y * gs + half);
			}

			// Waypoint dots
			gfx.lineStyle(0);
			for (const wp of remaining) {
				const on_level = (wp.level_id ?? '_default') === current_level;
				gfx.beginFill(on_level ? 0x00ffff : 0xff9900, on_level ? 1 : 0.5);
				gfx.drawCircle(wp.x * gs + half, wp.y * gs + half, on_level ? 4 : 3);
				gfx.endFill();
			}
		}

		canvas.stage.addChild(gfx);
	}

	// ── Structural layer (gated by toggle) ──────────────────────────────

	/** Render the structural overlay (walls, grid, stairs) */
	_render_struct() {
		if (!this._active) return;
		if (!canvas?.ready) return;

		if (this._struct_gfx) {
			this._struct_gfx.destroy({ children: true });
			this._struct_gfx = null;
		}

		const scene = canvas.scene;
		if (!scene) return;

		const grid_data = this._pathfinding._get_or_build_grid(scene);
		if (!grid_data) return;

		const gfx = new PIXI.Graphics();
		this._struct_gfx = gfx;

		const { grids, stairs_cells, gw, gh, cell_size, nav_resolution } = grid_data;

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

		canvas.stage.addChild(gfx);
	}

	/** Re-render everything (structural + paths). */
	_render() {
		this._render_struct();
		this._render_paths();
	}
}