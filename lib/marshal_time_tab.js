/**
 * marshal_time_tab.js — Session Time subtab on the Marshal sheet.
 */

import {
  apply_auto_time_preset,
  get_auto_time_public_state,
  on_auto_time_change,
  pause_auto_time,
  resume_auto_time,
  start_auto_time,
  stop_auto_time,
  MIN_DURATION_MIN,
  MAX_DURATION_MIN,
} from "./auto_time.js";

const MODULE_ID = "dc-npc-patrols";

function _tab_root(html) {
  return html?.querySelector?.('div.tab[data-tab="patrol_time"]')
    ?? html?.querySelector?.(".dc-patrol-time-tab")
    ?? html;
}

function _format_ut(ut) {
  if (!ut || !game.dc?.utils?.time?.format_campaign) return "—";
  return game.dc.utils.time.format_campaign(ut);
}

function _format_eta(eta_ms) {
  if (eta_ms == null) return game.i18n.localize("dc-npc-patrols.marshal.time.paused_eta");
  const total_sec = Math.ceil(eta_ms / 1000);
  const min = Math.floor(total_sec / 60);
  const sec = total_sec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${String(sec).padStart(2, "0")}s`;
}

export async function prepare_marshal_time_tab(actor) {
  const time = game.dc.utils.time.get_date();
  const auto = get_auto_time_public_state();

  return {
    time,
    auto,
    current_formatted: _format_ut(game.settings.get("Deadlands-Classic", "unixtime")),
    target_formatted: _format_ut(auto.target_ut),
    progress_pct: Math.round((auto.progress ?? 0) * 100),
    eta_label: _format_eta(auto.eta_ms),
    min_duration_min: MIN_DURATION_MIN,
    max_duration_min: MAX_DURATION_MIN,
    amount: auto.amount ?? 6,
    unit: auto.unit ?? "hours",
    duration_minutes: auto.duration_minutes ?? 10,
    presets: [
      { key: "hours_6", label: "dc-npc-patrols.marshal.time.preset_6h" },
      { key: "day_1", label: "dc-npc-patrols.marshal.time.preset_1d" },
      { key: "week_1", label: "dc-npc-patrols.marshal.time.preset_1w" },
    ],
  };
}

function _read_form(root) {
  const amount = Number(root.querySelector("[name='auto_time_amount']")?.value) || 1;
  const unit = root.querySelector("[name='auto_time_unit']")?.value || "hours";
  const duration_minutes = Number(root.querySelector("[name='auto_time_duration']")?.value)
    ?? MIN_DURATION_MIN;
  return { amount, unit, duration_minutes };
}

function _sync_form_labels(root, auto) {
  const progress = root.querySelector(".dc-auto-time-progress-bar");
  const progress_label = root.querySelector(".dc-auto-time-progress-label");
  const current_el = root.querySelector(".dc-auto-time-current");
  const target_el = root.querySelector(".dc-auto-time-target");
  const eta_el = root.querySelector(".dc-auto-time-eta");

  if (progress) progress.style.width = `${Math.round((auto.progress ?? 0) * 100)}%`;
  if (progress_label) {
    progress_label.textContent = game.i18n.format("dc-npc-patrols.marshal.time.progress", {
      pct: Math.round((auto.progress ?? 0) * 100),
    });
  }
  if (current_el) current_el.textContent = _format_ut(game.settings.get("Deadlands-Classic", "unixtime"));
  if (target_el) target_el.textContent = _format_ut(auto.target_ut);
  if (eta_el) eta_el.textContent = _format_eta(auto.eta_ms);

  const start_btn = root.querySelector("[data-action='auto-time-start']");
  const pause_btn = root.querySelector("[data-action='auto-time-pause']");
  const resume_btn = root.querySelector("[data-action='auto-time-resume']");
  const stop_btn = root.querySelector("[data-action='auto-time-stop']");

  if (start_btn) start_btn.disabled = !!auto.active;
  if (pause_btn) pause_btn.disabled = !auto.active || auto.paused;
  if (resume_btn) resume_btn.disabled = !auto.active || !auto.paused;
  if (stop_btn) stop_btn.disabled = !auto.active;
}

export function wire_marshal_time_tab(html, sheet) {
  const root = _tab_root(html);
  if (!root) return;

  if (root._dc_auto_time_unsub) {
    root._dc_auto_time_unsub();
    delete root._dc_auto_time_unsub;
  }

  root._dc_auto_time_unsub = on_auto_time_change((auto) => {
    _sync_form_labels(root, auto);
  });

  root.querySelectorAll("[data-action='auto-time-preset']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = apply_auto_time_preset(btn.dataset.preset);
      if (!preset) return;
      const amount_input = root.querySelector("[name='auto_time_amount']");
      const unit_select = root.querySelector("[name='auto_time_unit']");
      if (amount_input) amount_input.value = String(preset.amount);
      if (unit_select) unit_select.value = preset.unit;
    });
  });

  root.querySelector("[data-action='auto-time-start']")?.addEventListener("click", async () => {
    const form = _read_form(root);
    await start_auto_time(form);
    sheet.render(false);
  });

  root.querySelector("[data-action='auto-time-pause']")?.addEventListener("click", async () => {
    await pause_auto_time();
    sheet.render(false);
  });

  root.querySelector("[data-action='auto-time-resume']")?.addEventListener("click", async () => {
    await resume_auto_time();
    sheet.render(false);
  });

  root.querySelector("[data-action='auto-time-stop']")?.addEventListener("click", async () => {
    await stop_auto_time();
    sheet.render(false);
  });

  root.querySelector("[name='auto_time_duration']")?.addEventListener("input", (ev) => {
    const label = root.querySelector(".dc-auto-time-duration-value");
    if (label) {
      label.textContent = game.i18n.format("dc-npc-patrols.marshal.time.duration_value", {
        minutes: ev.target.value,
      });
    }
  });

  _sync_form_labels(root, get_auto_time_public_state());
}
