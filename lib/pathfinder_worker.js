/**
 * pathfinder_worker.js — Web Worker that executes A* searches off-thread.
 *
 * Receives serialized nav grids (once per scene) and individual path queries,
 * runs the pure solver to completion, and posts the resulting path back. The
 * search runs unbudgeted here — it never blocks the GM's main thread.
 *
 * Message protocol (from main thread):
 *   { type: "set_grid", id, scene_id, grid_data }   — cache a nav grid for a scene
 *   { type: "find_path", id, scene_id, query }        — run a search
 *
 * Replies:
 *   { type: "path", id, path }  — path is array of {x,y,level_id} or null
 */

import { solve_path } from "./pathfinder_core.js";

// Work in both browser Worker (global `self`) and Node worker_threads
// (globalThis exposes `postMessage` / `addEventListener` / `onmessage`).
let scope = globalThis.self ?? globalThis;
let post = scope.postMessage ? scope.postMessage.bind(scope) : null;
let onmsg = scope.onmessage;

// Node worker_threads: messaging goes through parentPort.
if (!post) {
	try {
		const { parentPort } = await import("node:worker_threads");
		if (parentPort) {
			post = (msg) => parentPort.postMessage(msg);
			onmsg = (fn) => parentPort.on("message", (d) => fn({ data: d }));
		}
	} catch { /* browser worker */ }
}

const grids = new Map(); // scene_id → grid_data

const handler = (event) => {
	const msg = event?.data ?? event;
	if (!msg || typeof msg.type !== "string") return;

	try {
		if (msg.type === "set_grid") {
			grids.set(msg.scene_id, msg.grid_data);
		} else if (msg.type === "find_path") {
			const grid_data = grids.get(msg.scene_id);
			if (!grid_data) {
				post({ type: "path", id: msg.id, path: null, error: "no grid for scene" });
				return;
			}
			const path = solve_path(grid_data, msg.query);
			post({ type: "path", id: msg.id, path });
		} else if (msg.type === "clear_scene") {
			grids.delete(msg.scene_id);
		}
	} catch (err) {
		post({ type: "path", id: msg.id, path: null, error: String(err?.stack || err) });
	}
};

if (onmsg) onmsg(handler);
else scope.addEventListener?.("message", handler);


