// ============================================================
// libs/db-production-load.js — live shop-floor load queries.
// Reads active work_orders for the Production Load view. Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';

// fetchActiveWorkOrders — every work_orders row still in production (status not
// completed), one per department-slice, with the columns the Production Load
// view groups on. Bounded by the status filter (completed rows are archived
// away). Output: { data, error }.
export async function fetchActiveWorkOrders() {
    const { data, error } = await withRetry(() =>
        supabase.from('work_orders')
            .select('id, wo_number, job_number, part_number, department, status, ' +
                    'qty_required, qty_completed, due_date, start_date')
            .neq('status', 'completed')
            .order('due_date', { ascending: true })
            .limit(2000)
    );
    return { data: data || [], error };
}

// updateWorkOrderDueDate — reschedule one WO department-slice (move up/back).
// Input: work_orders id, dueDate ('YYYY-MM-DD' or null). Output: { data, error }.
export async function updateWorkOrderDueDate(id, dueDate) {
    const { data, error } = await withRetry(() =>
        supabase.from('work_orders')
            .update({ due_date: dueDate || null, updated_at: new Date().toISOString() })
            .eq('id', id).select().single()
    );
    return { data, error };
}
