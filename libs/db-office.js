// ============================================================
// libs/db-office.js — Office / WO Status Supabase queries
//
// Extracted from db.js to keep files under 500 lines.
// Handles: WO receiving, closeout, Alere bin updates.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

export async function fetchWoStatusOrders() {
    // Parallel fetch: all non-closed tracking rows + received rows for closeout
    const [trackRes, receivedRes] = await Promise.all([
        withRetry(() =>
            supabase.from('wo_status_tracking')
                .select('*')
                .neq('erp_status', 'closed')
                .order('created_at', { ascending: false })
        ),
        withRetry(() =>
            supabase.from('wo_status_tracking')
                .select('*')
                .eq('erp_status', 'received')
                .order('received_at', { ascending: false })
        )
    ]);

    if (trackRes.error) return { woStatus: [], closeout: [], error: trackRes.error };

    // Join qty_completed from work_orders for closeout display
    const received = receivedRes.data || [];
    const woNums   = [...new Set(received.map(r => r.wo_number))];
    let woLookup   = {};

    if (woNums.length > 0) {
        const { data: wos } = await withRetry(() =>
            supabase.from('work_orders').select('wo_number,qty_completed').in('wo_number', woNums)
        );
        (wos || []).forEach(w => {
            if (!woLookup[w.wo_number]) woLookup[w.wo_number] = w.qty_completed;
        });
    }

    const closeout = received.map(r => ({
        ...r,
        qty_completed_fallback: woLookup[r.wo_number] || null
    }));

    return { woStatus: trackRes.data || [], closeout, error: null };
}

export async function searchWoForReceive(searchTerm) {
    if (!searchTerm) return { data: [], error: null };
    const t = searchTerm.trim();
    const [r1, r2, r3] = await Promise.all([
        withRetry(() => supabase.from('work_orders').select('*').eq('wo_number', t).neq('status', 'completed')),
        withRetry(() => supabase.from('work_orders').select('*').eq('sales_order', t).neq('status', 'completed')),
        withRetry(() => supabase.from('work_orders').select('*').ilike('part_number', '%' + t + '%').neq('status', 'completed'))
    ]);
    const combined = [...(r1.data || []), ...(r2.data || []), ...(r3.data || [])];
    const seen = new Set();
    const deduped = combined.filter(o => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
    });
    return { data: deduped, error: r1.error || r2.error || r3.error };
}

export async function fetchReceivingEligible() {
    const { data: wos, error: woErr } = await withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .in('department', ['Fab', 'Weld', 'TV Assy', 'TV. Assy', 'TV Assy.', 'TC Assy', 'TC. Assy', 'Trac Vac Assy', 'Tru Cut Assy'])
    );
    if (woErr) return { data: [], error: woErr };

    const { data: tracked } = await withRetry(() =>
        supabase.from('wo_status_tracking')
            .select('wo_number, job_number, erp_status')
            .in('erp_status', ['received', 'closed'])
    );
    // Exclude by wo_number when present; exclude by job_number for pending WOs (wo_number still null)
    const excludedWoNums  = new Set((tracked || []).filter(t => t.wo_number).map(t => t.wo_number));
    const excludedJobNums = new Set((tracked || []).filter(t => !t.wo_number && t.job_number).map(t => t.job_number));
    const eligible = (wos || []).filter(w => {
        if (w.wo_number)  return !excludedWoNums.has(w.wo_number);
        if (w.job_number) return !excludedJobNums.has(w.job_number);
        return true;
    });
    return { data: eligible, error: null };
}

// receiveWorkOrder — upserts a wo_status_tracking row as 'received'.
// If binLocation is non-empty, saves it to `location` and sets alere_bin_update_needed = true.
export async function receiveWorkOrder(order, qty, receivedBy, binLocation) {
    if (!receivedBy) return { data: null, error: new Error('Receiver name is required') };
    if (!order)      return { data: null, error: new Error('No order selected') };

    const cleanBin = (binLocation || '').trim();
    const payload = {
        wo_number:    order.wo_number,
        job_number:   order.job_number   || null,
        part_number:  order.part_number,
        description:  order.description,
        qty_required: order.qty_required,
        qty_received: qty || order.qty_completed || order.qty_required || 0,
        received_by:  receivedBy.trim(),
        erp_status:   'received',
        received_at:  new Date().toISOString(),
        ...(cleanBin ? {
            location:               cleanBin,
            alere_bin_update_needed: true
        } : {
            alere_bin_update_needed: false
        })
    };

    // Use wo_number as lookup key if available, otherwise fall back to job_number
    const lookupField = order.wo_number ? 'wo_number' : 'job_number';
    const lookupValue = order.wo_number || order.job_number;
    if (!lookupValue) return { data: null, error: new Error('Order has neither WO # nor Job #') };

    const { data: existing } = await withRetry(() =>
        supabase.from('wo_status_tracking').select('id').eq(lookupField, lookupValue).single()
    );

    if (existing) {
        return withRetry(() =>
            supabase.from('wo_status_tracking').update(payload).eq('id', existing.id).select()
        );
    } else {
        return withRetry(() =>
            supabase.from('wo_status_tracking').insert([payload]).select()
        );
    }
}

// autoReceiveAssyWo — inserts a 'received' tracking row when an Assy WO is completed.
// No-ops if a tracking row already exists for this WO number.
export async function autoReceiveAssyWo(order, operator) {
    if (!order?.wo_number && !order?.job_number) return;
    const lookupField = order.wo_number ? 'wo_number' : 'job_number';
    const lookupValue = order.wo_number || order.job_number;
    const { data: existing } = await withRetry(() =>
        supabase.from('wo_status_tracking').select('id').eq(lookupField, lookupValue).single()
    );
    if (existing) return;
    const { error } = await withRetry(() =>
        supabase.from('wo_status_tracking').insert([{
            wo_number:               order.wo_number,
            job_number:              order.job_number || null,
            part_number:             order.part_number,
            qty_required:            order.qty_required,
            qty_received:            order.qty_completed || order.qty_required || 0,
            received_by:             operator || 'Auto (Assy Complete)',
            erp_status:              'received',
            received_at:             new Date().toISOString(),
            alere_bin_update_needed: false
        }])
    );
    if (error) throw error;
}

// markAlereUpdated — clears the Alere bin update alert for a tracking row.
export async function markAlereUpdated(id, updatedBy) {
    if (!id)        return { data: null, error: new Error('Missing tracking row ID') };
    if (!updatedBy) return { data: null, error: new Error('User name is required') };

    return withRetry(() =>
        supabase.from('wo_status_tracking').update({
            alere_bin_update_needed: false,
            alere_bin_updated_at:    new Date().toISOString(),
            alere_bin_updated_by:    updatedBy.trim()
        }).eq('id', id).select()
    );
}

// archiveWorkOrder — copies all work_orders rows for a WO# into completed_work_orders, then deletes them.
// Fire-and-forget: called from closeOutWorkOrder without awaiting.
async function archiveWorkOrder(woNumber) {
    if (!woNumber) return;
    const { data: rows } = await withRetry(() =>
        supabase.from('work_orders').select('*').eq('wo_number', woNumber)
    );
    if (!rows?.length) return;
    const now = new Date().toISOString();
    const inserts = rows.map(({ id, ...rest }) => ({ ...rest, archived_at: now }));
    const { error: insertErr } = await withRetry(() =>
        supabase.from('completed_work_orders').insert(inserts)
    );
    if (insertErr) return;
    await withRetry(() =>
        supabase.from('work_orders').delete().eq('wo_number', woNumber)
    );
}

// updateTrackingWoNumberByJobNumber — backfills wo_number on a wo_status_tracking row
// that was received before the official WO# was known. Matches on job_number.
export async function updateTrackingWoNumberByJobNumber(jobNumber, woNumber) {
    if (!jobNumber || !woNumber) return { data: null, error: null };
    return withRetry(() =>
        supabase.from('wo_status_tracking')
            .update({ wo_number: woNumber })
            .eq('job_number', jobNumber)
            .is('wo_number', null)
            .select()
    );
}

// saveCloseoutNotes — updates closeout_notes on a tracking row. Fire-and-forget safe.
export async function saveCloseoutNotes(id, notes) {
    if (!id) return { data: null, error: new Error('Missing tracking row ID') };
    return withRetry(() =>
        supabase.from('wo_status_tracking')
            .update({ closeout_notes: (notes || '').trim() || null })
            .eq('id', id).select()
    );
}

// fetchClosedOutOrders — returns closed tracking rows within an optional date range.
// Input: from/to date strings (YYYY-MM-DD). Output: { data, error }
export async function fetchClosedOutOrders(from, to) {
    return withRetry(() => {
        let q = supabase.from('wo_status_tracking')
            .select('*')
            .eq('erp_status', 'closed')
            .order('closed_at', { ascending: false });
        if (from) q = q.gte('closed_at', from);
        if (to)   q = q.lte('closed_at', to + 'T23:59:59');
        return q;
    });
}

export async function closeOutWorkOrder(id, closedBy) {
    if (!id)       return { data: null, error: new Error('Missing tracking row ID') };
    if (!closedBy) return { data: null, error: new Error('Closer name is required') };

    const { data, error } = await withRetry(() =>
        supabase.from('wo_status_tracking').update({
            erp_status: 'closed',
            closed_by:  closedBy.trim(),
            closed_at:  new Date().toISOString()
        }).eq('id', id).select()
    );
    if (!error && data?.[0]?.wo_number) {
        archiveWorkOrder(data[0].wo_number); // fire-and-forget
    }
    return { data, error };
}
