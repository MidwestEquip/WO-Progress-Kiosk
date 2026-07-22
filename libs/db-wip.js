// ============================================================
// libs/db-wip.js — Part pipeline (WIP) reads
//
// Everything for a part that is in flight but not yet in part_on_hand:
// open requests, work orders on the floor, finished-but-not-received,
// and received-but-not-closed-out. Read-only.
//
// Returns raw rows — bucketing lives in utils.js (bucketPartWip).
// Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

// fetchPartWip — pipeline rows for one part via the get_part_wip RPC
// (dash/space-insensitive part match, one row per WO with qty collapsed
// across department rows).
// Input: part number string.
// Output: { data: { work_orders: [], requests: [] }, error }.
// Empty/invalid input short-circuits to empty arrays without a round trip.
export async function fetchPartWip(partNumber) {
    const part = (partNumber || '').trim();
    const empty = { work_orders: [], requests: [] };
    if (!part) return { data: empty, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_wip', { p_part: part })
    );
    if (error) return { data: empty, error };
    return { data: data || empty, error: null };
}

// fetchPartsWipBatch — pipeline rows for MANY parts via get_parts_wip_batch.
// The batch twin of fetchPartWip: a planning run needs hundreds of parts and
// the single-part RPC would be hundreds of round trips. Same row shapes, so
// each entry feeds bucketPartWip unchanged. Chunked to keep the array
// parameter a sane size.
// Input: array of part numbers (any casing/spacing).
// Output: { data: { NORM_NO_DASH: { work_orders: [], requests: [] } }, error }.
// Keys are the RPC's normalization (upper, trimmed, '-' and spaces removed) —
// callers must normalize the same way before looking a part up.
export async function fetchPartsWipBatch(partNumbers) {
    const list = [...new Set(
        (partNumbers || []).map(p => (p || '').toString().trim()).filter(Boolean)
    )];
    if (!list.length) return { data: {}, error: null };
    const out = {};
    for (let i = 0; i < list.length; i += 200) {
        const { data, error } = await withRetry(() =>
            supabase.rpc('get_parts_wip_batch', { p_parts: list.slice(i, i + 200) })
        );
        if (error) return { data: out, error };
        Object.assign(out, data || {});
    }
    return { data: out, error: null };
}
