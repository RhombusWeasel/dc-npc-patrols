/**
 * flag_condition boon handler — two-sided conditional gate based on quest flags.
 *
 * Checks an actor's quest_flags (actor scope) or posse_quest_flags (posse scope)
 * with 9 operators: exists, not_exists, equals, not_equals, greater, less,
 * greater_eq, less_eq, contains, starts_with.
 *
 * When the flag check is satisfied → satisfied_boons are applied.
 * When the flag check is NOT satisfied → unsatisfied_boons are applied.
 *
 * Uses the same flag namespaces as the dialog runner and modify_flag boon
 * (quest_flags / posse_quest_flags under the dc-npc-patrols flag scope).
 *
 * @param {object} boon   — { type, scope_type, flag_key, operator, expected_value,
 *                            satisfied_boons, unsatisfied_boons, target }
 * @param {object} context — mutable context from trigger_manager
 */
import { _evaluate_operator } from "../utils.js";

const MODULE_ID = "dc-npc-patrols";

export default function flag_condition(boon, context) {
	const actor = boon.target === 'target' ? (context.target ?? context.actor) : context.actor;
	if (!actor) return;

	const scope_type = boon.scope_type || 'actor';
	const flag_path = scope_type === 'posse' ? 'posse_quest_flags' : 'quest_flags';
	const key = boon.flag_key;
	if (!key) return;

	const flag_root = actor.getFlag(MODULE_ID, flag_path) || {};
	const actual = flag_root[key];
	const expected = boon.expected_value;
	const operator = boon.operator || 'exists';
	const satisfied = _evaluate_operator(actual, operator, expected);

	if (satisfied) {
		for (const nested of boon.satisfied_boons || []) {
			game.dc.boon_manager.handleBoon(nested, context);
		}
	} else {
		for (const nested of boon.unsatisfied_boons || []) {
			game.dc.boon_manager.handleBoon(nested, context);
		}
	}
}