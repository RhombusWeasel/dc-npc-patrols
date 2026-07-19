/**
 * bt_state.js — Scoped blackboard state keys for linked subtree execution.
 */

export function bb_state_key(bb, key) {
  return (bb._tick_scope ?? "") + key;
}
