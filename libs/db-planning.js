// ============================================================
// libs/db-planning.js — Production Planning queries
//
// Base-unit wizard reads (BOM batch fetches for the derivation
// engine) and base_units/-options/-option_parts CRUD.
// Imported and re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { RECORD_SOURCE_NATIVE } from './config.js';

// searchBomParents — distinct all_boms parents matching a family pattern,
// with line counts, for the wizard's sibling-config picker.
// Input: pattern (e.g. '880' matches 880*). Output: { data: [{ config, lineCount }], error }.
export async function searchBomParents(pattern) {
    const norm = normalizePartNumber(pattern);
    if (!norm) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('item_parent_normalized')
            .ilike('item_parent_normalized', `${norm}%`)
            .limit(6000)
    );
    if (error) return { data: [], error };
    const counts = {};
    (data || []).forEach(r => {
        counts[r.item_parent_normalized] = (counts[r.item_parent_normalized] || 0) + 1;
    });
    const list = Object.entries(counts)
        .map(([config, lineCount]) => ({ config, lineCount }))
        .sort((a, b) => b.lineCount - a.lineCount || a.config.localeCompare(b.config));
    return { data: list, error: null };
}

// fetchBomsForParents — all BOM lines for a set of parents in one query
// (the derivation engine's input). Input: array of config part numbers.
// Output: { data: all_boms rows, error }.
export async function fetchBomsForParents(parents) {
    const norms = [...new Set((parents || []).map(normalizePartNumber).filter(Boolean))];
    if (!norms.length) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('item_parent_normalized, item_child, item_child_normalized, qty_per_assy')
            .in('item_parent_normalized', norms)
            .limit(6000)
    );
    return { data: data || [], error };
}

// fetchItemDescriptions — first non-null item_master description per part,
// chunked for long lists. Input: part numbers. Output: { data: { NORM: descrip }, error }.
export async function fetchItemDescriptions(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const out = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('item_master')
                .select('item_normalized, descrip')
                .in('item_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: out, error };
        (data || []).forEach(r => {
            if (r.descrip && !out[r.item_normalized]) out[r.item_normalized] = r.descrip;
        });
    }
    return { data: out, error: null };
}

// fetchPartsWithBoms — which of these parts are themselves BOM parents
// (two-level kit detection). Input: part numbers. Output: { data: [norms], error }.
export async function fetchPartsWithBoms(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    if (!norms.length) return { data: [], error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('all_boms')
            .select('item_parent_normalized')
            .in('item_parent_normalized', norms)
            .limit(6000)
    );
    if (error) return { data: [], error };
    return { data: [...new Set((data || []).map(r => r.item_parent_normalized))], error: null };
}

// insertBomLinesBatch — write many BOM lines under one parent in a single
// insert, stamped source='native' (batch companion to db-bom insertBomLine;
// used by the wizard to save a base unit's ~100 common parts in one round trip).
// Input: parentPart, lines = [{ item_child, qty_per_assy }]. Output: { data, error }.
export async function insertBomLinesBatch(parentPart, lines) {
    const parent = (parentPart || '').trim().toUpperCase();
    if (!parent) return { data: null, error: new Error('Parent part number is required') };
    const rows = (lines || [])
        .map(l => {
            const child = (l.item_child || '').trim().toUpperCase();
            return child ? {
                item_parent: parent, item_parent_normalized: parent,
                item_child: child,   item_child_normalized:  child,
                qty_per_assy: Number(l.qty_per_assy) > 0 ? Number(l.qty_per_assy) : 1,
                source: RECORD_SOURCE_NATIVE,
            } : null;
        })
        .filter(Boolean);
    if (!rows.length) return { data: [], error: null };
    const { data, error } = await supabase.from('all_boms').insert(rows).select('id');
    return { data: data || [], error };
}

// fetchBomTreeRows — every BOM line beneath a set of root parts, fetched
// level-by-level in batches (one query per level, seen-set cycle guard,
// depth cap 12). The flat row array is explodeAndNet's bomRows input.
// Output: { data: all_boms rows, error, truncated }.
export async function fetchBomTreeRows(rootParts) {
    const seen = new Set((rootParts || []).map(normalizePartNumber).filter(Boolean));
    let frontier = [...seen];
    const allRows = [];
    let truncated = false;
    for (let depth = 0; depth < 12 && frontier.length; depth++) {
        const { data: rows, error } = await fetchBomsForParents(frontier);
        if (error) return { data: allRows, error, truncated };
        allRows.push(...rows);
        const next = new Set();
        rows.forEach(r => {
            const c = r.item_child_normalized;
            if (c && !seen.has(c)) { seen.add(c); next.add(c); }
        });
        frontier = [...next];
        if (depth === 11 && frontier.length) truncated = true;
    }
    return { data: allRows, error: null, truncated };
}

// fetchOpenWoSupply — open work-order supply per part. work_orders has one
// row per DEPARTMENT for the same WO, so remaining qty is taken as the MAX
// per wo_number (not the sum) to avoid multi-dept double-counting.
// Output: { data: { NORM: qty }, error }.
export async function fetchOpenWoSupply(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    if (!norms.length) return { data: {}, error: null };
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('work_orders')
                .select('wo_number, part_number, qty_required, qty_completed')
                .neq('status', 'completed')
                .in('part_number', norms.slice(i, i + 100))
        );
        if (error) return { data: map, error };
        const perWo = {};
        (data || []).forEach(r => {
            const part = normalizePartNumber(r.part_number);
            const key  = `${part}|${r.wo_number || r.part_number}`;
            const remaining = Math.max(0, (Number(r.qty_required) || 0) - (Number(r.qty_completed) || 0));
            if (!perWo[key] || perWo[key].remaining < remaining) perWo[key] = { part, remaining };
        });
        Object.values(perWo).forEach(({ part, remaining }) => {
            map[part] = (map[part] || 0) + remaining;
        });
    }
    return { data: map, error: null };
}

// fetchOpenPoSupply — open purchase-order supply per part: part-type orders,
// not forecasted, not completed; remaining = (ordered ?? needed) − received.
// Output: { data: { NORM: qty }, error }.
export async function fetchOpenPoSupply(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    if (!norms.length) return { data: {}, error: null };
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('purchasing_orders')
                .select('part_number, qty_needed, qty_ordered, qty_received, status')
                .eq('request_type', 'part')
                .eq('forecasted', false)
                .is('completed_at', null)
                .in('part_number', norms.slice(i, i + 100))
        );
        if (error) return { data: map, error };
        (data || []).forEach(r => {
            if (r.status === 'received') return;
            const part = normalizePartNumber(r.part_number);
            const expect = Number(r.qty_ordered) || Number(r.qty_needed) || 0;
            const remaining = Math.max(0, expect - (Number(r.qty_received) || 0));
            if (remaining > 0) map[part] = (map[part] || 0) + remaining;
        });
    }
    return { data: map, error: null };
}

// fetchPartPlanningParams — part_planning rows as a map for the netting engine.
// Output: { data: { NORM: row }, error }.
export async function fetchPartPlanningParams(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('part_planning')
                .select('*')
                .in('part_number_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: map, error };
        (data || []).forEach(r => { map[r.part_number_normalized] = r; });
    }
    return { data: map, error: null };
}

// fetchMakeBuyAttrs — derive make/buy per part from item_master attributes
// (attr_manufactured → 'make', attr_purchased → 'buy', both/neither → null).
// Output: { data: { NORM: 'make'|'buy'|null }, error }.
export async function fetchMakeBuyAttrs(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('item_master')
                .select('item_normalized, attr_manufactured, attr_purchased')
                .in('item_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: map, error };
        (data || []).forEach(r => {
            if (map[r.item_normalized] !== undefined) return;
            const make = r.attr_manufactured === true;
            const buy  = r.attr_purchased === true;
            map[r.item_normalized] = make === buy ? null : (make ? 'make' : 'buy');
        });
    }
    return { data: map, error: null };
}

// fetchBaseUnits — all base_units, newest first. Output: { data, error }.
export async function fetchBaseUnits() {
    const { data, error } = await withRetry(() =>
        supabase.from('base_units')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(500)
    );
    return { data: data || [], error };
}

// fetchBaseUnitDetail — one base_units row + its options + option parts.
// Output: { data: { unit, options: [{ ...option, parts: [] }] }, error }.
export async function fetchBaseUnitDetail(id) {
    const { data: unit, error: uErr } = await withRetry(() =>
        supabase.from('base_units').select('*').eq('id', id).single()
    );
    if (uErr) return { data: null, error: uErr };
    const { data: options, error: oErr } = await withRetry(() =>
        supabase.from('base_unit_options')
            .select('*')
            .eq('base_unit_id', id)
            .order('sort_order', { ascending: true })
    );
    if (oErr) return { data: null, error: oErr };
    const optIds = (options || []).map(o => o.id);
    let parts = [];
    if (optIds.length) {
        const { data: pRows, error: pErr } = await withRetry(() =>
            supabase.from('base_unit_option_parts')
                .select('*')
                .in('option_id', optIds)
        );
        if (pErr) return { data: null, error: pErr };
        parts = pRows || [];
    }
    const byOption = {};
    parts.forEach(p => (byOption[p.option_id] = byOption[p.option_id] || []).push(p));
    return {
        data: { unit, options: (options || []).map(o => ({ ...o, parts: byOption[o.id] || [] })) },
        error: null,
    };
}

// insertBaseUnitKit — save one confirmed kit: base_units row, then its option
// choices, then each choice's parts. Base-unit COMMON PARTS are NOT saved here —
// they are all_boms rows written via db-bom insertBomLine(s) by the caller.
// Input: unit = { family_name, base_part_number, included_configs, excluded_configs,
//                 status, notes, created_by },
//        options = [{ option_group, sort_order, required, choice_label, is_default,
//                     source, choice_configs, notes, parts: [{ part_number, qty_per_unit }] }]
// Output: { data: { id }, error } — rolls back the unit row if children fail.
export async function insertBaseUnitKit(unit, options) {
    const family = (unit?.family_name || '').trim();
    const basePart = (unit?.base_part_number || '').trim().toUpperCase();
    if (!family || !basePart) {
        return { data: null, error: new Error('Family name and base part number are required') };
    }
    const { data: unitRow, error: uErr } = await supabase
        .from('base_units')
        .insert({
            family_name: family,
            base_part_number: basePart,
            included_configs: unit.included_configs || [],
            excluded_configs: unit.excluded_configs || [],
            status: unit.status || 'draft',
            notes: unit.notes || null,
            created_by: unit.created_by || null,
        })
        .select()
        .single();
    if (uErr) return { data: null, error: uErr };

    try {
        for (const o of options || []) {
            const { data: optRow, error: oErr } = await supabase
                .from('base_unit_options')
                .insert({
                    base_unit_id: unitRow.id,
                    option_group: (o.option_group || '').trim() || 'Options',
                    sort_order: Number(o.sort_order) || 0,
                    required: !!o.required,
                    choice_label: (o.choice_label || '').trim() || '(unnamed)',
                    is_default: !!o.is_default,
                    source: o.source === 'manual' ? 'manual' : 'derived',
                    choice_configs: o.choice_configs || [],
                    notes: o.notes || null,
                })
                .select()
                .single();
            if (oErr) throw oErr;
            const parts = (o.parts || [])
                .map(p => ({
                    option_id: optRow.id,
                    part_number: (p.part_number || '').trim().toUpperCase(),
                    qty_per_unit: Number(p.qty_per_unit) > 0 ? Number(p.qty_per_unit) : 1,
                }))
                .filter(p => p.part_number);
            if (parts.length) {
                const { error: pErr } = await supabase.from('base_unit_option_parts').insert(parts);
                if (pErr) throw pErr;
            }
        }
        return { data: { id: unitRow.id }, error: null };
    } catch (err) {
        // Cascade delete removes any options/parts already inserted.
        await supabase.from('base_units').delete().eq('id', unitRow.id);
        return { data: null, error: err };
    }
}

// ── Saved-unit option editing ─────────────────────────────────
// A STEP is not a row: it is the (option_group, sort_order, required) triple
// repeated across every choice row in the step. Choice-level edits target one
// row by id; step-level edits must hit every row in the group, or the Plan tab
// (which groups on `sort_order|option_group`) splits one step into two.

// insertBaseUnitOption — add one choice, with its parts, to a saved base unit.
// Input: baseUnitId, option = { option_group, sort_order, required, choice_label,
//        is_default, source, choice_configs, notes, parts: [{ part_number, qty_per_unit }] }
// Output: { data: { id }, error }.
export async function insertBaseUnitOption(baseUnitId, option) {
    if (!baseUnitId) return { data: null, error: new Error('Base unit id is required') };
    const { data: row, error } = await supabase
        .from('base_unit_options')
        .insert({
            base_unit_id: baseUnitId,
            option_group: (option?.option_group || '').trim() || 'Options',
            sort_order: Number(option?.sort_order) || 0,
            required: !!option?.required,
            choice_label: (option?.choice_label || '').trim() || '(unnamed)',
            is_default: !!option?.is_default,
            source: option?.source === 'derived' ? 'derived' : 'manual',
            choice_configs: option?.choice_configs || [],
            notes: option?.notes || null,
        })
        .select('id')
        .single();
    if (error) return { data: null, error };
    const { error: pErr } = await replaceBaseUnitOptionParts(row.id, option?.parts);
    if (pErr) {
        await supabase.from('base_unit_options').delete().eq('id', row.id);
        return { data: null, error: pErr };
    }
    return { data: { id: row.id }, error: null };
}

// updateBaseUnitOption — patch choice-level fields on one option row.
// Step-level fields (option_group, sort_order, required) are deliberately
// excluded — use updateBaseUnitOptionGroup so the whole step moves together.
// Output: { data: row, error }.
export async function updateBaseUnitOption(id, fields) {
    const patch = {};
    if (fields.choice_label !== undefined) patch.choice_label = (fields.choice_label || '').trim() || '(unnamed)';
    if (fields.is_default   !== undefined) patch.is_default = !!fields.is_default;
    if (fields.notes        !== undefined) patch.notes = fields.notes || null;
    if (!Object.keys(patch).length) return { data: null, error: null };
    const { data, error } = await supabase
        .from('base_unit_options').update(patch).eq('id', id).select().single();
    return { data, error };
}

// deleteBaseUnitOption — remove one choice; its option parts cascade.
// Output: { data: row, error }.
export async function deleteBaseUnitOption(id) {
    const { data, error } = await supabase
        .from('base_unit_options').delete().eq('id', id).select().single();
    return { data, error };
}

// replaceBaseUnitOptionParts — set a choice's part package to exactly this list
// (delete-then-insert; an empty list leaves a valid part-less choice).
// Input: optionId, parts = [{ part_number, qty_per_unit }]. Output: { data, error }.
export async function replaceBaseUnitOptionParts(optionId, parts) {
    if (!optionId) return { data: null, error: new Error('Option id is required') };
    const { error: dErr } = await supabase
        .from('base_unit_option_parts').delete().eq('option_id', optionId);
    if (dErr) return { data: null, error: dErr };
    const rows = (parts || [])
        .map(p => ({
            option_id: optionId,
            part_number: (p.part_number || '').trim().toUpperCase(),
            qty_per_unit: Number(p.qty_per_unit) > 0 ? Number(p.qty_per_unit) : 1,
        }))
        .filter(p => p.part_number);
    if (!rows.length) return { data: [], error: null };
    const { data, error } = await supabase.from('base_unit_option_parts').insert(rows).select('id');
    return { data: data || [], error };
}

// updateBaseUnitOptionGroup — apply a step-level change (rename, required
// toggle, reorder) to EVERY choice row in one step, matched on the step's
// current identity. Input: baseUnitId, sortOrder, optionGroup (current name),
// fields = { option_group, required, sort_order }. Output: { data: rows, error }.
export async function updateBaseUnitOptionGroup(baseUnitId, sortOrder, optionGroup, fields) {
    if (!baseUnitId) return { data: [], error: new Error('Base unit id is required') };
    const patch = {};
    if (fields.option_group !== undefined) patch.option_group = (fields.option_group || '').trim() || 'Options';
    if (fields.required     !== undefined) patch.required = !!fields.required;
    if (fields.sort_order   !== undefined) patch.sort_order = Number(fields.sort_order) || 0;
    if (!Object.keys(patch).length) return { data: [], error: null };
    const { data, error } = await supabase
        .from('base_unit_options').update(patch)
        .eq('base_unit_id', baseUnitId)
        .eq('sort_order', sortOrder)
        .eq('option_group', optionGroup)
        .select();
    return { data: data || [], error };
}

// deleteBaseUnitOptionGroup — delete a whole step (all its choices; parts
// cascade). Output: { data: rows, error }.
export async function deleteBaseUnitOptionGroup(baseUnitId, sortOrder, optionGroup) {
    if (!baseUnitId) return { data: [], error: new Error('Base unit id is required') };
    const { data, error } = await supabase
        .from('base_unit_options').delete()
        .eq('base_unit_id', baseUnitId)
        .eq('sort_order', sortOrder)
        .eq('option_group', optionGroup)
        .select();
    return { data: data || [], error };
}

// setBaseUnitOptionDefault — make one choice the sole default of its step
// (clears the flag across the group, then sets it on the chosen row).
// Output: { data: row, error }.
export async function setBaseUnitOptionDefault(baseUnitId, sortOrder, optionGroup, optionId) {
    const { error: cErr } = await supabase
        .from('base_unit_options').update({ is_default: false })
        .eq('base_unit_id', baseUnitId)
        .eq('sort_order', sortOrder)
        .eq('option_group', optionGroup);
    if (cErr) return { data: null, error: cErr };
    const { data, error } = await supabase
        .from('base_unit_options').update({ is_default: true }).eq('id', optionId).select().single();
    return { data, error };
}

// updateBaseUnit — patch mutable fields on one base_units row.
// Output: { data: row, error }.
export async function updateBaseUnit(id, fields) {
    const patch = { updated_at: new Date().toISOString() };
    ['family_name', 'status', 'notes', 'updated_by', 'included_configs', 'excluded_configs']
        .forEach(k => { if (fields[k] !== undefined) patch[k] = fields[k]; });
    const { data, error } = await supabase
        .from('base_units').update(patch).eq('id', id).select().single();
    return { data, error };
}

// deleteBaseUnit — remove a base unit; options/parts cascade in the DB.
// The base part's all_boms rows and item_master record are NOT touched.
// Output: { data: row, error }.
export async function deleteBaseUnit(id) {
    const { data, error } = await supabase
        .from('base_units').delete().eq('id', id).select().single();
    return { data, error };
}
