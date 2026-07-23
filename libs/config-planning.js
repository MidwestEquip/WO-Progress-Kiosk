// ============================================================
// libs/config-planning.js — Production Planning constants.
//
// Split from config.js (July 2026) which was at 499/500. Same
// ROOT tier as config.js: ZERO imports allowed. Imported directly
// by planning consumers, NOT re-exported through config.js —
// config.js must stay at zero imports.
// ============================================================

// ----- Production Planning: year-supply basis -----
// Rolling window (days) for BOTH the base unit's sold qty and every subpart's
// demand — one period for both. Rolling, unlike BOM_PERIOD_* in config.js.
// PLAN_BASIS_* is the readable source of truth for planning_runs.plan_basis
// (that column has no CHECK constraint); 'kit' = the original explosion.
export const PLANNING_DEMAND_WINDOW_DAYS = 365;
export const PLAN_BASIS_KIT         = 'kit';
export const PLAN_BASIS_YEAR_SUPPLY = 'year_supply';
export const PLAN_PCT_ADJUST_MIN    = -100;  // Adjust %, signed whole percent
export const PLAN_PCT_ADJUST_MAX    = 500;
