// ============================================================
// libs/db-part-changes.js — Part Change records DB operations
//
// part_changes CRUD + replacement-chain resolution for
// historical usage calculations. Imported and re-exported
// by db.js.
// ============================================================

import { supabase } from './db-shared.js';
import { PART_CHANGE_CALC_CHAIN_MAX_DEPTH,
         PART_CHANGE_STATUS_OPEN } from './config.js';

// fetchPartChanges — change records for the list view, newest first.
// Input: optional status ('open'|'completed') to filter; omit for all.
// Capped at 500 rows so the query stays bounded as history grows.
// Returns { data, error }
export async function fetchPartChanges(status) {
    let q = supabase
        .from('part_changes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    return { data: data || [], error };
}

// insertPartChange — create a new part change record.
// Input: fields object (change_type, part_number, etc.).
// Returns { data, error } with the created row.
export async function insertPartChange(fields) {
    const { data, error } = await supabase
        .from('part_changes')
        .insert(fields)
        .select()
        .single();
    return { data, error };
}

// updatePartChange — patch any subset of fields on an existing record.
// Returns { data, error } with the updated row.
export async function updatePartChange(id, fields) {
    const { data, error } = await supabase
        .from('part_changes')
        .update(fields)
        .eq('id', id)
        .select()
        .single();
    return { data, error };
}

// fetchOpenChangesForPart — open (incomplete) change records for one part,
// newest first. Used for the "engineering change in progress" warning.
// Returns { data, error }
export async function fetchOpenChangesForPart(partNumber) {
    const norm = (partNumber || '').trim().toUpperCase();
    if (!norm) return { data: [], error: null };
    const { data, error } = await supabase
        .from('part_changes')
        .select('*')
        .eq('part_number_normalized', norm)
        .eq('status', PART_CHANGE_STATUS_OPEN)
        .order('created_at', { ascending: false });
    return { data: data || [], error };
}

// resolvePartCalcChain — walk replacement links backward from a part number
// so calculations can include history from parts it replaced.
// Follows only rows with change_type='replacement', use_previous_for_calcs=true,
// and a previous part set. Depth-capped and loop-guarded.
// Input: partNumber (any casing/whitespace).
// Returns { data: { chain, links }, error }:
//   chain — normalized part numbers, newest first: [self, prev, prev-prev, …]
//   links — the replacement rows followed (for breadcrumb notes), same order
// On any query error, returns the chain resolved so far (minimum: [self])
// so callers degrade to single-part behavior instead of failing.
export async function resolvePartCalcChain(partNumber) {
    const start = (partNumber || '').trim().toUpperCase();
    if (!start) return { data: { chain: [], links: [] }, error: null };

    const chain = [start];
    const links = [];
    const visited = new Set([start]);
    let current = start;

    for (let hop = 0; hop < PART_CHANGE_CALC_CHAIN_MAX_DEPTH; hop++) {
        const { data, error } = await supabase
            .from('part_changes')
            .select('id, part_number, previous_part_number, previous_part_number_normalized, replacement_reason, carry_forward_note, created_at')
            .eq('part_number_normalized', current)
            .eq('change_type', 'replacement')
            .eq('use_previous_for_calcs', true)
            .not('previous_part_number_normalized', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1);
        if (error) return { data: { chain, links }, error };
        const link = data && data[0];
        if (!link) break;                                    // end of chain
        const prev = link.previous_part_number_normalized;
        if (!prev || visited.has(prev)) break;               // loop guard
        visited.add(prev);
        chain.push(prev);
        links.push(link);
        current = prev;
    }
    return { data: { chain, links }, error: null };
}
