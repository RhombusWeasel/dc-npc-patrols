/**
 * bt_combat_log.js — One-shot combat BT warnings for GM debugging.
 */

const MODULE_ID = "dc-npc-patrols";

function _debug_enabled() {
  return game.settings.get(MODULE_ID, "bt_combat_debug") ?? false;
}

export function clear_combat_bt_warnings(bb) {
  if (!bb) return;
  for (const key of Object.keys(bb)) {
    if (key.startsWith("_combat_warn_")) delete bb[key];
  }
}

export function warn_combat_once(bb, key, message) {
  if (!bb?.is_my_turn || !game.user.isGM) return;

  const flag = `_combat_warn_${key}`;
  if (bb[flag]) return;
  bb[flag] = true;

  const name = bb.actor?.name ?? "NPC";
  const text = `${name}: ${message}`;
  console.warn(`dc-npc-patrols | ${text}`);

  if (_debug_enabled()) {
    ui.notifications.warn(text, { permanent: false });
  }
}

export function warn_combat_skip(actor_name, reason) {
  if (!game.user.isGM) return;
  console.warn(`dc-npc-patrols | combat turn skipped (${actor_name ?? "NPC"}): ${reason}`);
  if (_debug_enabled()) {
    ui.notifications.warn(`BT turn skipped: ${reason}`, { permanent: false });
  }
}
