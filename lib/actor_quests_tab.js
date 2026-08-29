/**
 * actor_quests_tab.js — Player-facing "Quests" tab for Deadlands character
 * sheets. Shows the actor's posse quest instances (GM-broadcast cache);
 * read-only for players, GM gets a per-row delete control routed through
 * the quest socket write path.
 */

import { get_current_quests, request_quest_state, request_quest_write } from "./quest_socket.js";

const MODULE_ID = "dc-npc-patrols";

/**
 * Build the quests-tab context for an actor.
 * @param {Actor} actor
 * @returns {Promise<object>}
 */
export async function prepare_quests_tab_context(actor) {
	const posse = game.dc.posse?.get_posse_for_actor(actor);
	if (!posse) {
		return { has_posse: false, is_gm: game.user.isGM, quests: [] };
	}

	request_quest_state(posse.id);
	const quests_map = get_current_quests(posse.id);

	const rows = Object.values(quests_map).map((q) => {
		const stages = Array.isArray(q.stages) ? q.stages : [];
		const stage = Number(q.stage) || 0;
		return {
			id: q.id,
			title: q.title || q.id,
			giver: q.giver || "",
			stage_label: stages[Math.min(stage, Math.max(stages.length - 1, 0))] || "",
			completed: !!q.completed,
			started: q.started || "",
			progress: `${stage}/${stages.length || 1}`,
		};
	});

	// Incomplete first (by started), completed after.
	rows.sort((a, b) => {
		if (a.completed !== b.completed) return a.completed ? 1 : -1;
		return String(a.started).localeCompare(String(b.started));
	});

	return { has_posse: true, posse_label: posse.label, is_gm: game.user.isGM, quests: rows };
}

/**
 * Wire the quests tab. Read-only for players; GM-only delete per row.
 * @param {HTMLElement} html — sheet root element
 * @param {object} sheet — actor sheet instance (sheet.actor resolvable)
 */
export function wire_quests_tab_events(html, sheet) {
	html.querySelectorAll("[data-action='delete-posse-quest']").forEach((el) => {
		if (el.dataset.wired) return;
		el.dataset.wired = "1";
		el.addEventListener("click", async (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			const actor = sheet?.actor ?? game.actors.get(sheet?.document?.id ?? sheet?.object?.id);
			const quest_id = ev.currentTarget.dataset.questId;
			const posse = game.dc.posse?.get_posse_for_actor(actor);
			if (!posse || !quest_id) return;
			await request_quest_write("delete", { posse_id: posse.id, quest_id });
		});
	});
}