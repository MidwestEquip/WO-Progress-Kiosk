// ============================================================
// libs/db-manager.js — Manager, KPI, WO Problems, Time Report queries
//
// Extracted from db.js to keep files under 500 lines.
// ============================================================

import { supabase, withRetry, normalizeDept } from './db-shared.js';
import { getStaleInfo } from './utils.js';

export async function fetchManagerAlerts() {
    const now          = new Date();
    const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(now.getDate() - 7);
    const fiveDaysAgo  = new Date(now); fiveDaysAgo.setDate(now.getDate() - 5);
    const twoDaysAgo   = new Date(now); twoDaysAgo.setDate(now.getDate() - 2);

    const [completedRes, activeRes, trackingRes, staleRes] = await Promise.all([
        withRetry(() =>
            supabase.from('work_orders')
                .select('*')
                .eq('status', 'completed')
                .lt('comp_date', sevenDaysAgo.toISOString())
        ),
        withRetry(() =>
            supabase.from('work_orders')
                .select('*')
                .in('status', ['paused', 'on_hold', 'started', 'resumed'])
        ),
        withRetry(() =>
            supabase.from('wo_status_tracking')
                .select('id,wo_number,qty_received,erp_status')
                .in('erp_status', ['received', 'closed'])
        ),
        withRetry(() =>
            supabase.from('open_orders')
                .select('id,customer,sales_order,part_number,status,last_status_update,deadline,wo_va_notes,wo_po_number')
                .in('status', ['New/Picking', 'WO Created'])
        )
    ]);

    const completedWos = completedRes.data || [];
    const activeWos    = activeRes.data    || [];
    const tracked      = trackingRes.data  || [];
    const staleWos     = staleRes.data     || [];

    const receivedOrClosedNums = new Set(tracked.map(t => t.wo_number));
    const completedNotReceived = completedWos
        .filter(w => !receivedOrClosedNums.has(w.wo_number))
        .slice(0, 5);

    const pausedOnHold = activeWos
        .filter(w => ['paused', 'on_hold'].includes(w.status))
        .filter(w => {
            const ref = w.start_date || w.created_at;
            return ref && new Date(ref) < fiveDaysAgo;
        })
        .slice(0, 5);

    const startedNoProgress = activeWos
        .filter(w => ['started', 'resumed'].includes(w.status))
        .filter(w => {
            const ref = w.start_date || w.created_at;
            return ref && new Date(ref) < twoDaysAgo && (parseFloat(w.qty_completed) || 0) === 0;
        })
        .slice(0, 5);

    const receivedOnly = tracked.filter(t => t.erp_status === 'received');
    let qtyMismatch = [];
    if (receivedOnly.length > 0) {
        const woNums = receivedOnly.map(t => t.wo_number);
        const { data: wos } = await withRetry(() =>
            supabase.from('work_orders').select('*').in('wo_number', woNums)
        );
        const woMap = {};
        (wos || []).forEach(w => { woMap[w.wo_number] = w; });
        qtyMismatch = receivedOnly
            .filter(t => {
                const wo = woMap[t.wo_number];
                if (!wo) return false;
                return parseFloat(t.qty_received) !== parseFloat(wo.qty_completed);
            })
            .map(t => ({ ...woMap[t.wo_number], qty_received: t.qty_received }))
            .slice(0, 5);
    }

    const staleOrders = staleWos
        .map(o => ({ ...o, staleInfo: getStaleInfo(o) }))
        .filter(o => o.staleInfo !== null);

    return {
        completedNotReceived,
        pausedOnHold,
        startedNoProgress,
        qtyMismatch,
        staleOrders,
        error: completedRes.error || activeRes.error || trackingRes.error || staleRes.error
    };
}

export async function fetchKpiData() {
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sevenDaysAgo  = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekStart     = new Date(); weekStart.setDate(weekStart.getDate() - 7);

    const [completedRes, activeRes] = await Promise.all([
        withRetry(() =>
            supabase.from('completed_work_orders').select('*')
                .gte('comp_date', thirtyDaysAgo.toISOString())
        ),
        withRetry(() =>
            supabase.from('work_orders').select('*').neq('status', 'completed')
        )
    ]);

    return {
        completed:    completedRes.data || [],
        active:       activeRes.data    || [],
        weekStart,
        sevenDaysAgo,
        error: completedRes.error || activeRes.error
    };
}

export async function fetchDelayedOrders() {
    const result = await withRetry(() =>
        supabase.from('work_orders').select('*').neq('status', 'completed')
    );
    if (result.data) result.data = result.data.map(normalizeDept);
    return result;
}

export async function fetchPriorityOrdersForDept(dept) {
    if (!dept) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .eq('department', dept)
            .neq('status', 'completed')
            .order('priority', { ascending: false })
            .order('due_date',  { ascending: true })
    );
}

// Set assigned_operator on a work order (planning field, does not affect logging).
export async function setAssignedOperator(id, operatorName) {
    if (id === undefined || id === null) return { data: null, error: new Error('Missing ID') };
    return withRetry(() =>
        supabase.from('work_orders')
            .update({ assigned_operator: operatorName || null })
            .eq('id', id).select()
    );
}

export async function setWorkOrderPriority(id, priority) {
    if (id === undefined || id === null) return { data: null, error: new Error('Missing ID') };
    const p = parseInt(priority, 10);
    if (isNaN(p) || p < 0 || p > 5)    return { data: null, error: new Error('Priority must be 0-5') };

    return withRetry(() =>
        supabase.from('work_orders').update({ priority: p }).eq('id', id).select()
    );
}

// ── WO Problem queries ────────────────────────────────────────

export async function fetchWoProblems() {
    return withRetry(() =>
        supabase.from('work_orders')
            .select('id,wo_number,part_number,department,operator,wo_problem_text,wo_problem_status,wo_problem_updated_at,wo_problem_updated_by,wo_problem_resolution')
            .eq('wo_problem_status', 'open')
            .not('wo_problem_text', 'is', null)
            .neq('wo_problem_text', '')
            .order('wo_problem_updated_at', { ascending: false })
    );
}

// Save a problem on a WO. Sets status to 'open' and records who/when.
export async function saveWoProblem(id, problemText, updatedBy) {
    if (!id)          return { data: null, error: new Error('Missing work order ID') };
    if (!problemText) return { data: null, error: new Error('Problem text is required') };

    return withRetry(() =>
        supabase.from('work_orders').update({
            wo_problem_text:       problemText.trim(),
            wo_problem_status:     'open',
            wo_problem_updated_at: new Date().toISOString(),
            wo_problem_updated_by: (updatedBy || '').trim() || null
        }).eq('id', id).select()
    );
}

// Mark a WO problem resolved. Resolution text and resolver name are required.
export async function resolveWoProblem(id, resolution, resolvedBy) {
    if (!id)         return { data: null, error: new Error('Missing work order ID') };
    if (!resolution) return { data: null, error: new Error('Resolution is required') };
    if (!resolvedBy) return { data: null, error: new Error('Resolver name is required') };

    return withRetry(() =>
        supabase.from('work_orders').update({
            wo_problem_status:     'resolved',
            wo_problem_resolution: resolution.trim(),
            wo_problem_updated_at: new Date().toISOString(),
            wo_problem_updated_by: resolvedBy.trim()
        }).eq('id', id).select()
    );
}

// ── AI Assistant context query ────────────────────────────────

// Fetch lightweight snapshots of active + recently-completed WOs for the AI assistant.
export async function fetchAiContextData() {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);

    const [activeRes, completedRes] = await Promise.all([
        withRetry(() =>
            supabase.from('work_orders')
                .select('id,wo_number,part_number,description,department,status,operator,start_date,created_at,qty_completed,qty_required')
                .neq('status', 'completed')
        ),
        withRetry(() =>
            supabase.from('completed_work_orders')
                .select('id,wo_number,part_number,department,operator,comp_date,qty_completed,qty_required')
                .gte('comp_date', weekStart.toISOString())
        )
    ]);

    return {
        active:    activeRes.data    || [],
        completed: completedRes.data || [],
        todayStart,
        error: activeRes.error || completedRes.error
    };
}

// ── Time Report ───────────────────────────────────────────────

// Fetch all wo_time_sessions within a date range, joining part_number from work_orders.
// Input: from/to ISO date strings. Output: { data, error }
export async function fetchTimeReportSessions(from, to) {
    return withRetry(() =>
        supabase.from('wo_time_sessions')
            .select('id, wo_id, wo_number, department, operator, started_at, ended_at, duration_minutes, qty_this_session, end_status, work_orders(part_number)')
            .gte('started_at', from)
            .lte('started_at', to)
            .not('ended_at', 'is', null)
            .order('started_at', { ascending: false })
    );
}
