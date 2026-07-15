/**
 * patrol_engine.js — Core schedule evaluation and animated token movement.
 *
 * Evaluates NPC patrol paths when time changes, builds a movement queue,
 * and animates tokens to their due waypoints (same-scene or cross-scene).
 */

import { CrossScene } from "./cross_scene.js";
import { RegionManager } from "./region_manager.js";

/**
 * Convert a unixtime (epoch ms, UTC) to campaign-local time components.
 * The DC system stores unixtime as a UTC epoch and converts to campaign
 * solar time using longitude: offset = round(lng / 15 * 60) minutes.
 */
function _to_campaign_components(unixtime) {
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

export class PatrolEngine {
	constructor(module_id, cross_scene, region_manager) {
		this.module_id = module_id;
		this.cross_scene = cross_scene;
		this.region_manager = region_manager;
		this._moving = false;
	}

	// --- Main entry: called when unixtime changes ---
	async evaluate_schedules(old_unixtime, new_unixtime) {
		if (!game.settings.get(this.module_id, "enable_patrols")) return;
		if (this._moving) return; // don't overlap movements

		const combat_freeze = game.settings.get(this.module_id, "combat_freeze");
		const combat_active = game.combat?.active ?? false;

		// Compute campaign-local time for old and new timestamps
		const old_date = _to_campaign_components(old_unixtime);
		const new_date = _to_campaign_components(new_unixtime);
		const old_minutes = old_date.hour * 60 + old_date.minute;
		const new_minutes = new_date.hour * 60 + new_date.minute;
		const weekday = new_date.weekday; // 0=Sun..6=Sat

		// Handle midnight rollover (day changed)
		const day_changed = (new_date.year !== old_date.year) ||
			(new_date.month !== old_date.month) ||
			(new_date.day !== old_date.day);

		console.log(`[${this.module_id}] Time changed: ${old_date.hour}:${String(old_date.minute).padStart(2,"0")} → ${new_date.hour}:${String(new_date.minute).padStart(2,"0")}, weekday=${weekday}, day_changed=${day_changed}`);

		// Find all NPC tokens on the current scene with patrol paths
		const npc_tokens = this._get_patrol_tokens();
		if (!npc_tokens.length) return;

		this._moving = true;
		try {
			for (let i = 0; i < npc_tokens.length; i++) {
				const { token, actor, paths } = npc_tokens[i];

				// Check combat behavior
				const combat_behavior = actor.getFlag(this.module_id, "combat_behavior") || "freeze";
				if (combat_active && combat_freeze && combat_behavior === "freeze") {
					continue; // skip frozen NPCs
				}

				// Find the active path for this weekday
				const active_path = this._find_active_path(paths, weekday);
				if (!active_path || !active_path.enabled) continue;

				// Find all due waypoints (time between old and new)
				const due_waypoints = this._find_due_waypoints(active_path, old_minutes, new_minutes, day_changed, old_date, new_date);

				if (!due_waypoints.length) continue;

				console.log(`[${this.module_id}] NPC "${token.name}" has ${due_waypoints.length} due waypoints:`, due_waypoints.map(w => `${w.label || w.time}`));

				// Stagger between NPCs
				if (i > 0) {
					const stagger = game.settings.get(this.module_id, "stagger_delay");
					await this._delay(stagger);
				}

				// Execute movement sequence
				await this._execute_movement(token, actor, due_waypoints);
			}
		} finally {
			this._moving = false;
		}
	}

	// --- Find all tokens with patrol data on the current scene ---
	_get_patrol_tokens() {
		const scene = canvas.scene;
		if (!scene) return [];

		const results = [];
		for (const token_doc of scene.tokens) {
			const actor = token_doc.actor;
			if (!actor) continue;

			const paths = actor.getFlag(this.module_id, "paths");
			if (!paths || !Array.isArray(paths) || !paths.length) continue;

			results.push({ token: token_doc, actor, paths });
		}
		return results;
	}

	// --- Find active path for a given weekday ---
	_find_active_path(paths, weekday) {
		// A path with no days set is active every day; otherwise only on listed days
		for (const path of paths) {
			if (!path.enabled) continue;
			if (!path.days || !path.days.length) return path; // empty days = all days
			if (path.days.includes(weekday)) return path;
		}
		return null;
	}

	// --- Find waypoints whose arrival time falls between old and new ---
	_find_due_waypoints(path, old_minutes, new_minutes, day_changed, old_date, new_date) {
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

	// --- Execute movement to a sequence of waypoints ---
	async _execute_movement(token_doc, actor, due_waypoints) {
		for (const wp of due_waypoints) {
			// Check if this is a cross-scene waypoint
			const target_scene_id = wp.scene_id;
			const current_scene_id = token_doc.parent?.id;

			if (target_scene_id && target_scene_id !== current_scene_id) {
				// Cross-scene: despawn on current, respawn on target
				await this.cross_scene.transition(token_doc, actor, wp);
			} else {
				// Same scene: animate token to waypoint
				await this._animate_to(token_doc, wp);
			}

			// Fire arrival dialog
			await this._fire_arrival(token_doc, actor, wp);
		}
	}

	// --- Animate a token to a waypoint position ---
	async _animate_to(token_doc, wp) {
		const token = token_doc.object;
		if (!token) return;

		const grid = token_doc.parent.grid.size;

		// If the waypoint has a route, animate through each intermediate point first
		if (wp.route && wp.route.length > 0) {
			for (const rp of wp.route) {
				const anim_data = { x: rp.x * grid, y: rp.y * grid };
				await token.animate(anim_data);
				// Persist intermediate position (without rotation)
				await token_doc.update({ x: Math.round(rp.x * grid), y: Math.round(rp.y * grid) });
			}
		}

		// Animate to final destination
		const px_x = wp.x * grid;
		const px_y = wp.y * grid;
		const anim_data = { x: px_x, y: px_y };
		if (wp.face_direction != null) {
			anim_data.rotation = wp.face_direction;
		}
		await token.animate(anim_data);

		// Persist the new position
		const update_data = { x: px_x, y: px_y };
		if (wp.face_direction != null) {
			update_data.rotation = wp.face_direction;
		}
		await token_doc.update(update_data);
	}

	// --- Post arrival chat line ---
	async _fire_arrival(token_doc, actor, wp) {
		if (!wp.arrival_lines || !wp.arrival_lines.length) return;

		const line = wp.arrival_lines[Math.floor(Math.random() * wp.arrival_lines.length)];
		const name = token_doc.name || actor.name;

		const flavor = game.i18n.format("dc-npc-patrols.panel.arrival_chat_flavor", {
			name: name,
			label: wp.label || "",
		});

		// Build a styled chat message (DC telegram style)
		const message_html = `
			<div class="dc-patrol-arrival">
				<div class="dc-patrol-arrival-flavor">${flavor}</div>
				<div class="dc-patrol-arrival-line"><strong>${name}:</strong> ${line}</div>
			</div>
		`;

		ChatMessage.create({
			user: game.user.id,
			speaker: { alias: name },
			content: message_html,
			style: CONST.CHAT_MESSAGE_STYLES.EMOTE,
		});
	}

	// --- Public methods (used by BTEngine as deps) ---

	/** Animate a token to a waypoint position. */
	async animate_to(token_doc, wp) {
		return this._animate_to(token_doc, wp);
	}

	/** Post arrival chat line. */
	async fire_arrival(token_doc, actor, wp) {
		return this._fire_arrival(token_doc, actor, wp);
	}

	// --- Utility: delay ---
	_delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}