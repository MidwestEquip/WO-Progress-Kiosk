// ============================================================
// libs/db-onhand.js — Native on-hand (part_on_hand) reads
//
// Read-only queries against the trigger-maintained part_on_hand
// table (Native Ledger Patch 2). Writes happen only inside the DB
// triggers — there is deliberately no write function here.
// Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

// fetchOnHandForParts — batch read of live on-hand for a set of part numbers.
// Input: array of part number strings (normalized internally, deduped; bounded
// by the caller's list — ancestors of one part, never a full scan).
// Output: { data: { [part_number_normalized]: { on_hand, counted_at } }, error }.
// A missing part means no native transaction or count has ever touched it;
// counted_at null means transactions exist but no physical count yet — the UI
// treats both as "not yet counted" and never shows their number as truth.
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
            .select('part_number_normalized, on_hand, counted_at')
            .in('part_number_normalized', list)
    );
    if (error) return { data: {}, error };
    const map = {};
    (data || []).forEach(r => {
        map[r.part_number_normalized] = { on_hand: Number(r.on_hand), counted_at: r.counted_at };
    });
    return { data: map, error: null };
}
