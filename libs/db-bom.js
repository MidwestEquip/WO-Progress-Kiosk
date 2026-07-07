// ============================================================
// libs/db-bom.js — BOM lookup/editing + native part creation
//
// all_boms line CRUD (edits stamped source='native') and
// item_master native part inserts (record_source='native').
// Imported and re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { RECORD_SOURCE_NATIVE } from './config.js';

// fetchBomWithDescriptions — BOM lines for one parent part, each enriched with
// the item_master description (canonical desc source; covers native parts too).
// Returns { data: [{ id, item_child, item_child_normalized, qty_per_assy, source, description }], error }.
export async function fetchBomWithDescriptions(parentPart) {
    const normalized = normalizePartNumber(parentPart);
    if (!normalized) return { data: [], error: null };

    const { data: lines, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('id, item_child, item_child_normalized, qty_per_assy, source')
            .eq('item_parent_normalized', normalized)
            .order('item_child_normalized', { ascending: true })
    );
    if (error) return { data: [], error };
    const rows = lines || [];
    if (!rows.length) return { data: [], error: null };

    // item_master has one row per item/store/bin — keep the first non-null desc per item
    const children = [...new Set(rows.map(r => r.item_child_normalized).filter(Boolean))];
    const { data: descRows } = await withRetry(() =>
        supabase.from('item_master')
            .select('item_normalized, descrip')
            .in('item_normalized', children)
    );
    const descs = {};
    (descRows || []).forEach(r => {
        if (r.descrip && !descs[r.item_normalized]) descs[r.item_normalized] = r.descrip;
    });
    return {
        data: rows.map(r => ({ ...r, description: descs[r.item_child_normalized] || '' })),
        error: null,
    };
}

// checkPartExists — true when any item_master row matches the part number.
// Returns { data: boolean, error }.
export async function checkPartExists(partNumber) {
    const normalized = normalizePartNumber(partNumber);
    if (!normalized) return { data: false, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('item_master')
            .select('id')
            .eq('item_normalized', normalized)
            .limit(1)
    );
    return { data: !!(data && data.length), error };
}

// insertBomLine — add a child line to a parent's BOM, stamped source='native'.
// Part numbers are trimmed + uppercased. Returns { data: row, error }.
export async function insertBomLine(parentPart, childPart, qtyPerAssy) {
    const parent = (parentPart || '').trim().toUpperCase();
    const child  = (childPart  || '').trim().toUpperCase();
    if (!parent || !child) return { data: null, error: new Error('Parent and child part numbers are required') };
    const { data, error } = await supabase
        .from('all_boms')
        .insert({
            item_parent: parent, item_parent_normalized: parent,
            item_child: child,   item_child_normalized:  child,
            qty_per_assy: Number(qtyPerAssy) || 1,
            source: RECORD_SOURCE_NATIVE,
        })
        .select()
        .single();
    return { data, error };
}

// updateBomLine — patch qty and/or child part on one BOM row (by id).
// Any edit re-stamps source='native'. Returns { data: row, error }.
export async function updateBomLine(id, fields) {
    const patch = { source: RECORD_SOURCE_NATIVE };
    if (fields.qty_per_assy !== undefined) patch.qty_per_assy = Number(fields.qty_per_assy) || 1;
    if (fields.item_child !== undefined) {
        const child = (fields.item_child || '').trim().toUpperCase();
        if (!child) return { data: null, error: new Error('Child part number cannot be blank') };
        patch.item_child = child;
        patch.item_child_normalized = child;
    }
    const { data, error } = await supabase
        .from('all_boms')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// deleteBomLine — remove one line from a BOM (the part itself is untouched).
// Returns { data: deleted row, error }.
export async function deleteBomLine(id) {
    const { data, error } = await supabase
        .from('all_boms')
        .delete()
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// insertItemMasterPart — create a native part record. Rejects duplicates
// (case-insensitive) so an Alere-imported part can't be shadowed.
// Returns { data: row, error }.
export async function insertItemMasterPart(fields) {
    const item = (fields.item || '').trim().toUpperCase();
    if (!item) return { data: null, error: new Error('Part number is required') };

    const { data: exists, error: checkErr } = await checkPartExists(item);
    if (checkErr) return { data: null, error: checkErr };
    if (exists)   return { data: null, error: new Error(`Part ${item} already exists`) };

    const { data, error } = await supabase
        .from('item_master')
        .insert({ ...fields, item, record_source: RECORD_SOURCE_NATIVE })
        .select()
        .single();
    return { data, error };
}
