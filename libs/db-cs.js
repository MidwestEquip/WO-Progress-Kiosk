// ============================================================
// libs/db-cs.js — Customer Service Supabase queries
//
// Extracted from db.js to keep files under 500 lines.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { searchUnitCompletionsByTerm } from './db-assy.js';

export async function searchCsOrders(term) {
    if (!term) return { timeline: [], open: [], error: null };
    const t = term.trim();
    const [r1, r2, r3] = await Promise.all([
        withRetry(() => supabase.from('work_orders').select('*').eq('wo_number', t)),
        withRetry(() => supabase.from('work_orders').select('*').eq('sales_order', t)),
        withRetry(() => supabase.from('work_orders').select('*').ilike('part_number', '%' + t + '%').neq('status', 'completed'))
    ]);
    return {
        byWo:   r1.data || [],
        bySo:   r2.data || [],
        byPart: r3.data || [],
        error:  r1.error || r2.error || r3.error
    };
}

export async function fetchCsSupplementalData(woNumber, partNumber) {
    const [statusRes, historyRes] = await Promise.all([
        withRetry(() =>
            supabase.from('wo_status_tracking').select('*').eq('wo_number', woNumber)
        ),
        withRetry(() =>
            supabase.from('completed_work_orders')
                .select('department,start_date,comp_date')
                .eq('part_number', partNumber)
        )
    ]);
    return {
        statusRows:  statusRes.data  || [],
        historyRows: historyRes.data || [],
        error:       statusRes.error || historyRes.error
    };
}

// Search completed assembly WOs by WO#, SO#, Part#, Description, Job#,
// Unit Serial#, Engine Serial# (on WO row), and unit/engine serials in wo_unit_completions.
const ASSY_DEPTS = ['TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy', 'Assy'];
export async function searchPastAssyOrders(term) {
    if (!term) return { rows: [], error: null };
    const t = term.trim();
    const cols = 'id,wo_number,job_number,sales_order,part_number,description,department,comp_date,qty_required,tv_assy_notes,tc_assy_notes_differences_mods,unit_serial_number,engine_serial_number,num_blades';
    const base = () => supabase.from('completed_work_orders')
        .select(cols)
        .in('department', ASSY_DEPTS)
        .limit(50);

    // Search WO row fields + wo_unit_completions in parallel
    const [r1, r2, r3, r4, r5, r6, r7, unitHits] = await Promise.all([
        withRetry(() => base().eq('wo_number',             t)),
        withRetry(() => base().eq('sales_order',           t)),
        withRetry(() => base().eq('job_number',            t)),
        withRetry(() => base().ilike('part_number',        '%' + t + '%')),
        withRetry(() => base().ilike('description',        '%' + t + '%')),
        withRetry(() => base().ilike('unit_serial_number', '%' + t + '%')),
        withRetry(() => base().ilike('engine_serial_number', '%' + t + '%')),
        searchUnitCompletionsByTerm(t),
    ]);
    const err = r1.error || r2.error || r3.error || r4.error || r5.error || r6.error || r7.error;
    if (err) return { rows: [], error: err };

    // Fetch WO rows for any wo_unit_completions hits not already covered
    let unitRows = [];
    if (!unitHits.error && unitHits.data?.length) {
        const woNumbers = [...new Set(unitHits.data.map(r => r.wo_number))];
        const { data, error: uErr } = await withRetry(() =>
            supabase.from('completed_work_orders')
                .select(cols)
                .in('department', ASSY_DEPTS)
                .in('wo_number', woNumbers)
        );
        if (!uErr) unitRows = data || [];
    }

    const seen = new Set();
    const rows = [];
    for (const row of [
        ...(r1.data||[]), ...(r2.data||[]), ...(r3.data||[]),
        ...(r4.data||[]), ...(r5.data||[]), ...(r6.data||[]),
        ...(r7.data||[]), ...unitRows,
    ]) {
        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    }
    return { rows, error: null };
}
