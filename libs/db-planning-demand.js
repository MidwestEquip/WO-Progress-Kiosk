// ============================================================
// libs/db-planning-demand.js — Year-Supply planning demand reads
//
// Two batch reads that size a year-supply planning run:
//   fetchPartsParentDemandBatch — every subpart's parent-usage demand
//   fetchBaseUnitSold12Mo       — the base unit's own sold qty
//
// Both are READ-ONLY by design. Imported and re-exported by db.js.
// Calls supabase.rpc directly rather than importing a sibling db-*.js
// file (no db → db edges; see db-open-orders.js for the precedent).
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { PLANNING_DEMAND_WINDOW_DAYS } from './config-planning.js';

// _rollingWindow — the demand window both fetches must share, as
// { start, end } YYYY-MM-DD local date strings. Centralized here so the
// base unit's qty and its subparts' qty can never be measured over
// different periods. Deliberately rolling, NOT the fixed BOM_PERIOD_START
// calendar year that the WO Request modal defaults to.
function _rollingWindow() {
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const end = new Date();
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - PLANNING_DEMAND_WINDOW_DAYS);
    return { start: fmt(start), end: fmt(end) };
}

// Exposed so callers can snapshot the exact window a run was sized over.
export function planningDemandWindow() { return _rollingWindow(); }

// fetchPartsParentDemandBatch — parent-usage demand for many parts at once.
// Calls the get_parts_parent_demand RPC (SECURITY DEFINER): walks all_boms
// upward from each part, multiplies qty_per_assy along each path, and sums
// ancestor sales over the window. The batch twin of
// calculateRecursiveParentUsageDemand() in db-part-defaults.js.
//
// Input:  partNumbers = [] (normalized internally), optional start/end.
// Output: { data: { [PART_NORM]: demand }, error } — the RPC returns a row
//         per input part, so every requested key is present. On error the
//         map is empty; callers must treat a missing key as 0, never as
//         "no demand known".
export async function fetchPartsParentDemandBatch(partNumbers, pStart = null, pEnd = null) {
    if (!partNumbers || partNumbers.length === 0) return { data: {}, error: null };
    const normalized = [...new Set(partNumbers.map(p => normalizePartNumber(p)).filter(Boolean))];
    if (!normalized.length) return { data: {}, error: null };
    const win = _rollingWindow();
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_parts_parent_demand', {
            p_parts: normalized,
            p_start: pStart || win.start,
            p_end:   pEnd   || win.end,
        })
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => { map[r.part_normalized] = Number(r.parent_demand) || 0; });
    return { data: map, error: null };
}

// fetchBaseUnitSold12Mo — how many of a base unit actually sold over the
// window, used to auto-fill Qty to Plan.
//
// A family sells under its CONFIG part numbers (base_units.included_configs),
// not under the pseudo base part number, so the configs are what gets summed.
// The base part number is included only as a fallback for families with no
// configs recorded — on a normal family it contributes 0 and is harmless.
//
// Input:  configParts = [] config part numbers, basePart = string|null.
// Output: { data: { total, byPart: { [PART_NORM]: qty }, window }, error }.
export async function fetchBaseUnitSold12Mo(configParts, basePart = null, pStart = null, pEnd = null) {
    const win = _rollingWindow();
    const window = { start: pStart || win.start, end: pEnd || win.end };
    const empty = { total: 0, byPart: {}, window };
    const parts = [...new Set([...(configParts || []), basePart]
        .map(p => normalizePartNumber(p)).filter(Boolean))];
    if (!parts.length) return { data: empty, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_sales_analysis_sold', {
            p_parts: parts,
            p_start: window.start,
            p_end:   window.end,
        })
    );
    if (error) return { data: empty, error };
    const byPart = {};
    let total = 0;
    (data || []).forEach(r => {
        const qty = Number(r.qty_sold) || 0;
        byPart[r.item_normalized] = qty;
        total += qty;
    });
    return { data: { total, byPart, window }, error: null };
}
