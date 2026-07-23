// ============================================================
// libs/db-open-orders.js — Open Orders board queries that don't fit in
// db-inventory.js (kept under the 500-line cap). Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { NATIVE_CUTOVER_DATE, TXN_SOURCE_NATIVE, OPEN_ORDER_DEMAND_STATUSES } from './config.js';
import { buildOpenOrderTerminalTxns } from './utils.js';

// ── Native inventory ledger writes ────────────────────────────
// Co-located with shipOpenOrder (which emits internally) so no db sub-file
// ever imports another. The ONLY app write path into issues_receipts.

// _localTxnDate — YYYY-MM-DD in the local timezone (ledger txn_date).
function _localTxnDate() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// insertInventoryTxns — inserts native ledger rows into issues_receipts.
// Stamps source='native' and txn_date (local today, unless the builder set
// one) so the utils builders stay pure. Rows carry deterministic
// native_event_key values (unique index) and inserts are conflict-ignored,
// so double-clicks, lost-ack retries, and logical replays collapse to
// no-ops — and the part_on_hand AFTER trigger never double-fires.
// No .select(): clients hold INSERT-only access (return=minimal).
// Input: rows from a utils build* function. Output: { error } — callers
// treat failures as non-fatal + toast.
export async function insertInventoryTxns(rows) {
    if (!rows || !rows.length) return { error: null };
    const today   = _localTxnDate();
    const stamped = rows.map(r => ({
        ...r,
        source:   TXN_SOURCE_NATIVE,
        txn_date: r.txn_date || today,
    }));
    const { error } = await withRetry(() =>
        supabase.from('issues_receipts')
            .upsert(stamped, { onConflict: 'native_event_key', ignoreDuplicates: true })
    );
    return { error };
}

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

// ── Completed Orders queries (relocated verbatim from db-inventory.js,
//    which sat at 499/500 — Native Ledger Patch 4a, no behavior change) ──

// shipOpenOrder — copies a row from open_orders into open_orders_completed then deletes
// the original. row: full open_orders object. shipped_at is set to now().
// finalStatus defaults to 'Shipped'; pass 'Deleted' for recoverable row deletes —
// the row lands in Completed Orders where Restore can bring it back.
export async function shipOpenOrder(row, finalStatus = 'Shipped') {
    const now = new Date().toISOString();
    const { id, created_at, updated_at, ...fields } = row;
    const { error: insertErr } = await withRetry(() =>
        supabase.from('open_orders_completed').insert([{
            ...fields,
            original_id: id,
            status:      finalStatus,
            shipped_at:  now,
            updated_at:  now,
        }])
    );
    if (insertErr) return { error: insertErr };

    // Native ledger emission (non-fatal): Shipped → SO/S stock-out;
    // Deleted/Cancelled → negative SO/O sold reversal. Emitted after the
    // completed-copy succeeds, independent of the delete leg — replays after
    // a failed delete re-use the same deterministic key and are ignored.
    // Callers surface ledgerError as a toast; the board move never blocks.
    let ledgerError = null;
    const txns = buildOpenOrderTerminalTxns(row, finalStatus, NATIVE_CUTOVER_DATE);
    if (txns.length) {
        ({ error: ledgerError } = await insertInventoryTxns(txns));
    }

    const del = await withRetry(() => supabase.from('open_orders').delete().eq('id', id));
    return { ...del, ledgerError };
}

// fetchCompletedOrders — open_orders_completed rows, newest shipped first.
// (The view re-sorts client-side to keep same-SO rows grouped; this order just
// keeps the raw fetch consistent with what the table shows.)
// sinceIso (optional ISO timestamp): only rows shipped on/after it, plus rows
// with no shipped_at at all (pre-feature/legacy rows would otherwise be
// invisible forever). Omit it to fetch every row.
export async function fetchCompletedOrders(sinceIso) {
    return withRetry(() => {
        let q = supabase.from('open_orders_completed').select('*');
        if (sinceIso) q = q.or(`shipped_at.gte.${sinceIso},shipped_at.is.null`);
        return q.order('shipped_at', { ascending: false, nullsFirst: false });
    });
}

// countCompletedOrdersBefore — how many completed rows shipped BEFORE sinceIso.
// Head-only count (no rows transferred); drives the "Load more" button's
// visibility and its remaining-count label. Returns { count, error }.
export async function countCompletedOrdersBefore(sinceIso) {
    if (!sinceIso) return { count: 0, error: null };
    return withRetry(() =>
        supabase.from('open_orders_completed')
            .select('id', { count: 'exact', head: true })
            .lt('shipped_at', sinceIso)
    );
}

// deleteCompletedOrder — hard-delete one open_orders_completed row (used by Restore).
export async function deleteCompletedOrder(id) {
    if (!id) return { error: new Error('Missing completed order ID') };
    return withRetry(() => supabase.from('open_orders_completed').delete().eq('id', id));
}

// updateCompletedOrder — patch fields on one open_orders_completed row (inline
// cell edits: notes, tracking #). Mirrors updateOpenOrder but targets the
// completed table. patch: { column: value, ... }. Output: { error }.
export async function updateCompletedOrder(id, patch) {
    if (!id) return { error: new Error('Missing completed order ID') };
    return withRetry(() =>
        supabase.from('open_orders_completed').update(patch).eq('id', id));
}

// findOpenOrdersByPartForWoSync — active open_orders rows shipping this exact part,
// for the WO request/approval → board status sync. Deliberately does NOT match the
// waiting_on JSONB: subpart rows track their own WO via woInfoByPart and must keep
// their main status. Returns only the columns buildOpenOrderWoSyncUpdates reads.
// Input: part # (blank → []). Output: { data: rows, error }.
export async function findOpenOrdersByPartForWoSync(partNumber) {
    const part = (partNumber || '').trim().toUpperCase();
    if (!part) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('open_orders')
            .select('id, status, wo_po_number, part_number, chute_status')
            .eq('part_number', part)
    );
    return { data: data || [], error };
}

// fetchOpenOrderQtyForParts — batch read of qty still owed on the live board
// for a set of parts. Read-only; the board is never written from here.
//
// Filtered on BOTH axes (never a full-table scan): status is restricted to
// OPEN_ORDER_DEMAND_STATUSES (outstanding demand only — picked/created/boxed
// rows are already covered) and part_number to the caller's list, chunked so a
// long ancestor list cannot blow the request URL.
//
// Input: array of part number strings (trim+UPPER'd and deduped internally;
// board rows are stored uppercase by open-orders-add.js, and returned values
// are re-normalized when summing so a hand-edited mixed-case row still lands).
// Output: { data: { [PART_NUMBER]: qty }, error }. A part with nothing on the
// board is simply absent — callers treat absence as 0. Null to_ship counts 0.
export async function fetchOpenOrderQtyForParts(partNumbers) {
    const list = [...new Set(
        (partNumbers || []).map(p => (p || '').trim().toUpperCase()).filter(Boolean)
    )];
    if (!list.length) return { data: {}, error: null };

    const CHUNK = 150;
    const map = {};
    for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        const { data, error } = await withRetry(() =>
            supabase.from('open_orders')
                .select('part_number, to_ship')
                .in('status', OPEN_ORDER_DEMAND_STATUSES)
                .in('part_number', chunk)
        );
        if (error) return { data: {}, error };
        (data || []).forEach(r => {
            const part = (r.part_number || '').trim().toUpperCase();
            if (!part) return;
            map[part] = (map[part] || 0) + (Number(r.to_ship) || 0);
        });
    }
    return { data: map, error: null };
}
