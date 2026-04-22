// ============================================================
// libs/db-cs.js — Customer Service Supabase queries
//
// Extracted from db.js to keep files under 500 lines.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

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

// Search completed assembly WOs by WO#, SO#, Part#, or Description.
// Returns up to 50 rows with assy-specific fields selected.
const ASSY_DEPTS = ['TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy', 'Assy'];
export async function searchPastAssyOrders(term) {
    if (!term) return { rows: [], error: null };
    const t = term.trim();
    const cols = 'id,wo_number,sales_order,part_number,description,department,comp_date,qty_required,tv_assy_notes,tc_assy_notes_differences_mods,unit_serial_number,engine_serial_number,num_blades';
    const base = () => supabase.from('completed_work_orders')
        .select(cols)
        .in('department', ASSY_DEPTS)
        .limit(50);

    const [r1, r2, r3, r4] = await Promise.all([
        withRetry(() => base().eq('wo_number',   t)),
        withRetry(() => base().eq('sales_order', t)),
        withRetry(() => base().ilike('part_number', '%' + t + '%')),
        withRetry(() => base().ilike('description', '%' + t + '%')),
    ]);
    const err = r1.error || r2.error || r3.error || r4.error;
    if (err) return { rows: [], error: err };

    const seen = new Set();
    const rows = [];
    for (const row of [...(r1.data||[]), ...(r2.data||[]), ...(r3.data||[]), ...(r4.data||[])]) {
        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    }
    return { rows, error: null };
}
