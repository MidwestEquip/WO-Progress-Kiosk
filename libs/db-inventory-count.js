// ============================================================
// libs/db-inventory-count.js — Inventory Count sheet queries
//
// CRUD against inventory_count_lines (parts exported from a
// Production Planning run that need a physical count), plus the
// batch item_master read that supplies description + bin.
// Re-exported by db.js. No business logic.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';

// Adjusted rows older than this drop off the sheet's history panel — the open
// list is always complete, the done list is bounded so it cannot grow forever.
const ADJUSTED_HISTORY_DAYS = 30;

// fetchInventoryCountLines — the count sheet. Always returns every OPEN
// (unadjusted) line; adjusted lines only when includeAdjusted is true, and
// then only the last 30 days (bounded query).
// Input: includeAdjusted boolean. Output: { data: [rows], error }.
export async function fetchInventoryCountLines(includeAdjusted) {
    let q = supabase.from('inventory_count_lines').select('*');
    if (includeAdjusted) {
        const since = new Date(Date.now() - ADJUSTED_HISTORY_DAYS * 86400000).toISOString();
        q = q.or(`adjusted.eq.false,adjusted_at.gte.${since}`);
    } else {
        q = q.eq('adjusted', false);
    }
    const { data, error } = await withRetry(() =>
        q.order('created_at', { ascending: false }).limit(2000)
    );
    return { data: data || [], error };
}

// fetchOpenCountParts — normalized part numbers already sitting UNADJUSTED on
// the sheet, for the export dedup check. Input: part numbers to test.
// Output: { data: Set of normalized parts, error }.
export async function fetchOpenCountParts(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    if (!norms.length) return { data: new Set(), error: null };
    const out = new Set();
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('inventory_count_lines')
                .select('part_number_normalized')
                .eq('adjusted', false)
                .in('part_number_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: out, error };
        (data || []).forEach(r => out.add(r.part_number_normalized));
    }
    return { data: out, error: null };
}

// insertInventoryCountLines — add rows to the sheet.
// Input: array of { part_number, source, source_run_id, created_by }.
// Output: { data: [inserted rows], error }.
export async function insertInventoryCountLines(rows) {
    if (!rows || !rows.length) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('inventory_count_lines').insert(rows).select()
    );
    return { data: data || [], error };
}

// updateInventoryCountLine — patch one line (qty counted, or the adjusted stamp).
// Inputs: id, fields object. Output: { data: row|null, error }.
export async function updateInventoryCountLine(id, fields) {
    const { data, error } = await withRetry(() =>
        supabase.from('inventory_count_lines').update(fields).eq('id', id).select()
    );
    return { data: (data && data[0]) || null, error };
}

// deleteInventoryCountLine — drop a line off the sheet (it was not needed).
// Input: id. Output: { error }.
export async function deleteInventoryCountLine(id) {
    const { error } = await withRetry(() =>
        supabase.from('inventory_count_lines').delete().eq('id', id)
    );
    return { error };
}

// fetchItemMasterForParts — batch reference read for the count sheet: the
// description, bin location and system on-hand for a bounded list of parts.
// Chunked at 100. Matched on item_normalized (same key fetchItemDescriptions
// uses), so a part with no item_master row is simply absent from the map.
// Input: part numbers. Output: { data: { NORM: { id, item, descrip, bin,
// lonhand, manual_qty_check, date_manual_count } }, error }.
export async function fetchItemMasterForParts(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const out = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('item_master')
                .select('id, item, item_normalized, descrip, bin, lonhand, manual_qty_check, date_manual_count')
                .in('item_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: out, error };
        (data || []).forEach(r => { if (!out[r.item_normalized]) out[r.item_normalized] = r; });
    }
    return { data: out, error: null };
}
