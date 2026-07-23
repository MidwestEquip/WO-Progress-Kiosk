// ============================================================
// libs/db-onhand.js — Native on-hand (part_on_hand) reads
//
// Read-only queries against the trigger-maintained part_on_hand
// table (Native Ledger Patch 2). Writes happen only inside the DB
// triggers — there is deliberately no write function here.
// Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

// fetchOnHandForParts — batch read of EFFECTIVE live on-hand for a set of parts.
// Input: array of part number strings (normalized internally, deduped; bounded
// by the caller's list — ancestors of one part, never a full scan).
// Output: { data: { [part_number_normalized]:
//              { on_hand, counted_at, basis, baseline_estimate } }, error }.
//
// on_hand is the EFFECTIVE quantity, resolved from the baseline model:
//   counted (counted_at set)  → on_hand as stored   (count + deltas since count)
//   uncounted                 → max(0, baseline_estimate) + on_hand
//                               (frozen pre-cutover estimate + deltas since cutover)
// basis is 'count' or 'estimate' so callers can label the number without a
// second query; baseline_estimate is the raw (possibly negative) seed.
//
// A missing part means no ledger row at all (no history, no txn, no count) —
// callers treat absence as 0. counted_at null = never physically counted (the
// number is an estimate, still usable for netting but shown as estimated).
// importInventoryCount — record a physical count via the import_inventory_count
// RPC (SECURITY DEFINER — the only client path that can create IC rows; the
// insert policy blocks direct IC writes). The IC row SETS part_on_hand.on_hand
// and stamps counted_at via the AFTER trigger. countedBy is required (audit).
// Inputs: part # string, qty (0–99999), countedBy name. Output: { error }.
export async function importInventoryCount(partNumber, qty, countedBy) {
    const { error } = await withRetry(() =>
        supabase.rpc('import_inventory_count', {
            p_part:       partNumber,
            p_qty:        qty,
            p_counted_by: countedBy,
        })
    );
    return { error };
}

export async function fetchOnHandForParts(partNumbers) {
    const list = [...new Set(
        (partNumbers || []).map(p => (p || '').trim().toUpperCase()).filter(Boolean)
    )];
    if (!list.length) return { data: {}, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('part_on_hand')
            .select('part_number_normalized, on_hand, counted_at, baseline_estimate')
            .in('part_number_normalized', list)
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => {
        const delta    = Number(r.on_hand) || 0;
        const baseline = Number(r.baseline_estimate) || 0;   // null → 0
        const counted  = r.counted_at != null;
        // Counted parts trust the stored counter as-is; uncounted parts add the
        // deltas onto the floored estimate baseline (never re-floored here so a
        // net-negative shows a real shortfall, matching counted-part behavior).
        const effective = counted ? delta : Math.max(0, baseline) + delta;
        map[r.part_number_normalized] = {
            on_hand:           effective,
            counted_at:        r.counted_at,
            basis:             counted ? 'count' : 'estimate',
            baseline_estimate: r.baseline_estimate == null ? null : baseline,
        };
    });
    return { data: map, error: null };
}
