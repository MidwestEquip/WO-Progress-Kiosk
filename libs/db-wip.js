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
