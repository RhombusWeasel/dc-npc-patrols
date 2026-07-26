/**
 * auto_time.js — Gradual campaign time advancement for BT schedule nodes.
 */

import { is_dc_combat_active } from "./combat_turn.js";

const MODULE_ID = "dc-npc-patrols";
const TICK_MS = 1000;
const RENDER_THROTTLE_MS = 5000;
const MIN_DURATION_MIN = 5;
const MAX_DURATION_MIN = 120;

const UNIT_MS = {
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
};

const PRESETS = {
  hours_6: { amount: 6, unit: "hours" },
  day_1: { amount: 1, unit: "days" },
  week_1: { amount: 1, unit: "weeks" },
};

let _interval_id = null;
let _last_render_ms = 0;
const _listeners = new Set();

function _default_state() {
  return {
    active: false,
    paused: false,
    combat_paused: false,
    start_ut: 0,
    target_ut: 0,
    wall_start: 0,
    wall_duration_ms: 0,
    last_flushed_ut: 0,
    amount: 6,
    unit: "hours",
    duration_minutes: 10,
  };
}

function _get_state() {
  return foundry.utils.mergeObject(_default_state(), game.settings.get(MODULE_ID, "auto_time_state") ?? {}, {
    inplace: false,
    overwrite: true,
  });
}

async function _save_state(state) {
  await game.settings.set(MODULE_ID, "auto_time_state", state);
}

function _in_game_ms(amount, unit) {
  const mult = UNIT_MS[unit];
  if (!mult) return 0;
  return Math.max(0, Number(amount) || 0) * mult;
}

function _duration_ms(minutes) {
  const clamped = Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Number(minutes) || MIN_DURATION_MIN));
  return clamped * 60 * 1000;
}

function _rerender_marshal_sheets() {
  for (const actor of game.actors) {
    if (actor.type !== "gm" || !actor.sheet?.rendered) continue;
    actor.sheet.render(false);
  }
}

function _notify_listeners() {
  for (const fn of _listeners) {
    try {
      fn(get_auto_time_public_state());
    } catch (err) {
      console.error("[dc-npc-patrols] auto_time listener failed:", err);
    }
  }
}

function _compute_progress(state) {
  if (!state.active || !state.wall_duration_ms) {
    return { progress: 0, eta_ms: 0, current_ut: game.settings.get("Deadlands-Classic", "unixtime") };
  }
  const elapsed = state.combat_paused && state.pause_wall_at
    ? state.pause_wall_at - state.wall_start
    : Date.now() - state.wall_start;
  const progress = Math.min(1, Math.max(0, elapsed / state.wall_duration_ms));
  const current_ut = Math.round(state.start_ut + (state.target_ut - state.start_ut) * progress);
  const eta_ms = state.paused || state.combat_paused
    ? null
    : Math.max(0, state.wall_duration_ms - elapsed);
  return { progress, eta_ms, current_ut };
}

export function on_auto_time_change(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function get_auto_time_public_state() {
  const state = _get_state();
  const { progress, eta_ms, current_ut } = _compute_progress(state);
  return {
    ...state,
    progress,
    eta_ms,
    current_ut,
    preset_keys: Object.keys(PRESETS),
    min_duration_min: MIN_DURATION_MIN,
    max_duration_min: MAX_DURATION_MIN,
  };
}

export function is_auto_time_active() {
  const state = _get_state();
  return !!state.active;
}

function _ensure_interval() {
  if (_interval_id) return;
  _interval_id = window.setInterval(() => {
    void _tick();
  }, TICK_MS);
}

function _clear_interval() {
  if (!_interval_id) return;
  window.clearInterval(_interval_id);
  _interval_id = null;
}

async function _flush_full_effects(from_ut, to_ut) {
  if (to_ut <= from_ut) return;
  await game.dc.utils.time.set_unixtime(to_ut, { effects: "full", old_ut: from_ut });
}

async function _clear_running_state() {
  await _save_state(_default_state());
  _clear_interval();
  _notify_listeners();
}

async function _tick() {
  if (!game.user.isGM) return;

  let state = _get_state();
  if (!state.active) {
    _clear_interval();
    return;
  }

  if (state.paused) return;

  if (is_dc_combat_active() || game.paused) {
    if (!state.combat_paused) {
      state.combat_paused = true;
      state.pause_wall_at = Date.now();
      await _save_state(state);
      _notify_listeners();
    }
    return;
  }

  if (state.combat_paused && state.pause_wall_at) {
    const paused_ms = Date.now() - state.pause_wall_at;
    state.wall_duration_ms += paused_ms;
    state.combat_paused = false;
    delete state.pause_wall_at;
    await _save_state(state);
  }

  const { progress } = _compute_progress(state);
  const new_ut = Math.round(state.start_ut + (state.target_ut - state.start_ut) * progress);

  await game.dc.utils.time.set_unixtime(new_ut, { effects: "sync_only" });

  const now = Date.now();
  if (now - _last_render_ms >= RENDER_THROTTLE_MS) {
    _rerender_marshal_sheets();
    _last_render_ms = now;
    _notify_listeners();
  }

  if (progress >= 1) {
    await _flush_full_effects(state.last_flushed_ut || state.start_ut, state.target_ut);
    await _clear_running_state();
    ui.notifications.info(game.i18n.localize("dc-npc-patrols.marshal.time.complete"));
  }
}

export async function start_auto_time({ amount, unit, duration_minutes } = {}) {
  if (!game.user.isGM) return;
  const existing = _get_state();
  if (existing.active) {
    await stop_auto_time();
  }

  const start_ut = game.settings.get("Deadlands-Classic", "unixtime");
  const in_game_ms = _in_game_ms(amount, unit);
  if (in_game_ms <= 0) {
    ui.notifications.warn(game.i18n.localize("dc-npc-patrols.marshal.time.invalid_amount"));
    return;
  }

  const state = {
    ..._default_state(),
    active: true,
    start_ut,
    target_ut: start_ut + in_game_ms,
    wall_start: Date.now(),
    wall_duration_ms: _duration_ms(duration_minutes),
    last_flushed_ut: start_ut,
    amount: Number(amount) || 1,
    unit: unit || "hours",
    duration_minutes: Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Number(duration_minutes) || 10)),
  };

  await _save_state(state);
  _ensure_interval();
  _notify_listeners();
  void _tick();
}

export async function pause_auto_time() {
  const state = _get_state();
  if (!state.active || state.paused) return;
  state.paused = true;
  await _save_state(state);
  _notify_listeners();
}

export async function resume_auto_time() {
  const state = _get_state();
  if (!state.active || !state.paused) return;
  if (state.combat_paused && state.pause_wall_at) {
    const paused_ms = Date.now() - state.pause_wall_at;
    state.wall_duration_ms += paused_ms;
    state.combat_paused = false;
    delete state.pause_wall_at;
  }
  state.paused = false;
  await _save_state(state);
  _notify_listeners();
  void _tick();
}

export async function stop_auto_time() {
  const state = _get_state();
  if (!state.active) return;

  const current_ut = game.settings.get("Deadlands-Classic", "unixtime");
  await _flush_full_effects(state.last_flushed_ut || state.start_ut, current_ut);
  await _clear_running_state();
  _rerender_marshal_sheets();
  ui.notifications.info(game.i18n.localize("dc-npc-patrols.marshal.time.stopped"));
}

export function apply_auto_time_preset(preset_key) {
  return PRESETS[preset_key] ?? null;
}

export async function restore_auto_time() {
  if (!game.user.isGM) return;
  const state = _get_state();
  if (!state.active) return;
  _ensure_interval();
  _notify_listeners();
  void _tick();
}

export { PRESETS, MIN_DURATION_MIN, MAX_DURATION_MIN, UNIT_MS };

