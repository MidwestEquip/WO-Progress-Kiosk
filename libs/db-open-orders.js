// ============================================================
// libs/db-open-orders.js — Open Orders board queries that don't fit in
// db-inventory.js (kept under the 500-line cap). Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

// fetchWorkOrderStatuses — live status of a set of work orders, for the Open
// Orders "Waiting On" column. ONE bounded query (never a full scan, never
// select('*')); the wo_number list is deduped + normalized (trim+UPPER) to match
// how work_orders.wo_number is stored, and chunked so a large board never builds
// an oversized IN() URL. One WO spans multiple department rows (Fab/Weld/Assy),
// so the caller collapses rows per wo_number.
// Input: array of wo_number strings. Output: { data: rows, error }; data is []
// for empty/invalid input. Rows: { wo_number, status, department }.
export async function fetchWorkOrderStatuses(woNumbers) {
    const list = Array.from(new Set(
        (Array.isArray(woNumbers) ? woNumbers : [])
            .map(w => (w || '').trim().toUpperCase())
            .filter(Boolean)
    ));
    if (!list.length) return { data: [], error: null };

    const CHUNK = 150;
    const out = [];
    for (let i = 0; i < list.length; i += CHUNK) {
        const slice = list.slice(i, i + CHUNK);
        const { data, error } = await withRetry(() =>
            supabase.from('work_orders')
                .select('wo_number, status, department')
                .in('wo_number', slice)
        );
        if (error) return { data: [], error };
        if (data) out.push(...data);
    }
    return { data: out, error: null };
}

// fetchWaitingOnWosForParts — active work orders for a set of part numbers, for the
// Open Orders "Waiting On" subpart auto-link. Differs from fetchActiveWosForParts
// (import auto-attach) in that it ALSO returns a WO that's been created but is still
// awaiting its official Alere WO# — those rows have a job_number but a null wo_number.
// Filtered by the part list (bounded) and non-completed; returns rows carrying either
// identifier so a pending WO still links + shows its status. Input: array of part #
// strings. Output: { data: rows, error }; data is [] for empty/invalid input.
export async function fetchWaitingOnWosForParts(parts) {
    const list = Array.from(new Set(
        (Array.isArray(parts) ? parts : [])
            .map(p => (p || '').trim().toUpperCase())
            .filter(Boolean)
    ));
    if (!list.length) return { data: [], error: null };
    // Include active WOs, PLUS WOs completed recently (last 60 days) so a just-finished
    // subpart shows "Complete" instead of reverting to "WO Requested". Bounded by the part
    // list AND the recency window — never pulls a part's entire completed history (which
    // would falsely mark a subpart done from an old, unrelated WO). The two .or() groups
    // are ANDed by PostgREST: has-identifier AND (still-active OR recently-completed).
    const cutoff = new Date(Date.now() - 60 * 86400000).toISOString();
    return withRetry(() =>
        supabase.from('work_orders')
            .select('wo_number, job_number, part_number, status')
            .in('part_number', list)
            .or('wo_number.not.is.null,job_number.not.is.null')
            .or(`status.neq.completed,updated_at.gte.${cutoff}`)
    );
}

// findOpenOrdersForPart — active open_orders rows that a WO's part feeds, for the
// office Receiving modal "Sales Orders using this part" panel. Two bounded, filtered
// queries merged + deduped by id:
//   1. rows whose part_number IS this part (the SO ships this exact part), and
//   2. rows whose waiting_on JSONB lists this part (the SO is blocked on it as a subpart).
// part is normalized (trim+UPPER) to match how both part_number and waiting_on entries
// are stored. Input: part # string (may be blank → []). Output: { data: rows, error };
// each row: { id, sales_order, part_number, description, status, order_type, to_ship, store_bin }.
export async function findOpenOrdersForPart(partNumber) {
    const part = (partNumber || '').trim().toUpperCase();
    if (!part) return { data: [], error: null };
    const cols = 'id, sales_order, part_number, description, status, order_type, to_ship, store_bin, waiting_on';

    const byPart = await withRetry(() =>
        supabase.from('open_orders').select(cols).eq('part_number', part));
    if (byPart.error) return { data: [], error: byPart.error };

    // waiting_on is jsonb: the containment value must be passed as a JSON STRING.
    // supabase-js would otherwise encode a JS array as a Postgres array literal ({...}),
    // which the server rejects with "invalid input syntax for type json".
    const byWaiting = await withRetry(() =>
        supabase.from('open_orders').select(cols).contains('waiting_on', JSON.stringify([{ part_number: part }])));
    if (byWaiting.error) return { data: [], error: byWaiting.error };

    const seen = new Map();
    for (const r of [...(byPart.data || []), ...(byWaiting.data || [])]) {
        if (!seen.has(r.id)) seen.set(r.id, r);
    }
    return { data: Array.from(seen.values()), error: null };
}
