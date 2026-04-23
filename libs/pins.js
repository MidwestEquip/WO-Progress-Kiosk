// ============================================================
// libs/pins.js — Runtime PIN cache. Zero imports.
//
// setPins(map) is called once at startup by main.js after
// fetching from Supabase. getPin(name) is used by splash-view.js
// for comparisons instead of hardcoded constants.
// ============================================================

let _pins = {};

// setPins — store the name→pin map loaded from app_pins table.
export function setPins(map) { _pins = map || {}; }

// getPin — return the PIN for a given name, or '' if not yet loaded.
export function getPin(name) { return _pins[name] || ''; }
