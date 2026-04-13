// ============================================================
// libs/db.js — Core Supabase operations + re-export hub
//
// Contains: dashboard queries, updateOrderStatus, undo, manual WO,
//           notes, insertProgressEvent.
// All other domain functions live in db-*.js sub-files and are
// re-exported here so callers can keep: import * as db from './db.js'
//
// RULES:
//  - NO Vue imports, NO state mutations, NO UI logic
//  - Every function returns { data, error } or throws
// ============================================================

import { supabase, withRetry, DEPT_ALIASES, normalizeDept } from './db-shared.js';

// Re-export shared helpers (db-assy.js imports withRetry from here)
export { withRetry, supabase } from './db-shared.js';

// Re-export all domain sub-files so callers need only one import
export * from './db-office.js';
export * from './db-manager.js';
export * from './db-inventory.js';
export * from './db-cs.js';
export * from './db-storage.js';

// ── Dashboard queries ─────────────────────────────────────────

export async function fetchDeptOrders(dept) {
    if (!dept) return { data: [], error: null };
    const deptFilter = DEPT_ALIASES[dept] || [dept];
    const result = await withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .in('department', deptFilter)
            .neq('status', 'completed')
            .order('priority', { ascending: false })
            .order('due_date',  { ascending: true })
    );
    if (result.data) result.data = result.data.map(normalizeDept);
    return result;
}

export async function fetchAllActiveOrders() {
    return withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .neq('status', 'completed')
            .order('priority', { ascending: false })
    );
}

// updateOrderStatus: builds the full update payload and writes it atomically.
// Returns { data, error }.
export async function updateOrderStatus({ id, currentOrder, newStatus, stageKey, opName, actionForm }) {
    if (!id)        return { data: null, error: new Error('Missing work order ID') };
    if (!newStatus) return { data: null, error: new Error('Missing new status') };
    if (!opName)    return { data: null, error: new Error('Operator name is required') };

    const now = new Date().toISOString();
    const isFabWeld = !stageKey &&
        (currentOrder.department === 'Fab' || currentOrder.department === 'Weld');
    const sessionQty = parseFloat(actionForm.qtyCompleted) || 0;
    const updates = {
        operator:      opName,
        qty_completed: isFabWeld
            ? (parseFloat(currentOrder.qty_completed) || 0) + sessionQty
            : sessionQty
    };

    // ── Sub-stage logic (TC Assy / TV Assy) ──────────────────
    let overallStatus = newStatus;
    if (stageKey) {
        updates[stageKey + '_status'] = newStatus;
        if (stageKey.startsWith('tc_')) updates[stageKey + '_operator'] = opName;

        if (currentOrder.department === 'Tru Cut Assy') {
            const fin = stageKey === 'tc_final'   ? newStatus : currentOrder.tc_final_status;
            const pre = stageKey === 'tc_pre_lap' ? newStatus : currentOrder.tc_pre_lap_status;
            if (fin === 'completed')                          overallStatus = 'completed';
            else if (pre === 'started' || fin === 'started') overallStatus = 'started';
            else                                              overallStatus = currentOrder.status;
        }

        if (currentOrder.department === 'Trac Vac Assy') {
            const fin = stageKey === 'tv_final'  ? newStatus : currentOrder.tv_final_status;
            const eng = stageKey === 'tv_engine' ? newStatus : currentOrder.tv_engine_status;
            const crt = stageKey === 'tv_cart'   ? newStatus : currentOrder.tv_cart_status;
            if (fin === 'completed')                                               overallStatus = 'completed';
            else if (fin === 'started' || eng === 'started' || crt === 'started') overallStatus = 'started';
            else                                                                   overallStatus = currentOrder.status;
        }
    }

    updates.status = overallStatus;

    // ── Timestamps ────────────────────────────────────────────
    if (overallStatus === 'started' && !currentOrder.start_date) {
        updates.start_date = now;
    }
    if (overallStatus === 'completed') {
        updates.comp_date = now;
        if (!stageKey &&
            currentOrder.department !== 'Tru Cut Assy' &&
            currentOrder.department !== 'Trac Vac Assy') {
            if (!updates.qty_completed) updates.qty_completed = currentOrder.qty_required;
        }
    }

    // ── Notes / history log ───────────────────────────────────
    let newLine;
    if (isFabWeld) {
        const ts = new Date().toLocaleString([], {
            month: '2-digit', day: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        const label = { started: 'STARTED', paused: 'PAUSED', on_hold: 'ON HOLD', completed: 'COMPLETED' }[newStatus] || newStatus.toUpperCase();
        newLine = `[${ts}] ${opName}: ${label}`;
        if ((newStatus === 'paused' || newStatus === 'completed') && sessionQty > 0) {
            newLine += ` | ${sessionQty} pcs this session | Total: ${updates.qty_completed} / ${currentOrder.qty_required}`;
        }
        if (newStatus === 'on_hold' && actionForm.holdReason) {
            newLine += ` | Reason: ${actionForm.holdReason}`;
        }
        if (actionForm.qtyScrap > 0) {
            newLine += ` | Scrap: ${actionForm.qtyScrap}${actionForm.scrapReason ? ' (' + actionForm.scrapReason + ')' : ''}`;
        }
        if (actionForm.notes) newLine += ` | ${actionForm.notes}`;
    } else {
        newLine = `[${new Date().toLocaleDateString()}] ${opName} marked ${stageKey ? stageKey + ' ' : ''}${newStatus}`;
        if (newStatus === 'on_hold' && actionForm.holdReason) newLine += ` - Reason: ${actionForm.holdReason}`;
        if (actionForm.qtyScrap > 0) newLine += ` | SCRAP: ${actionForm.qtyScrap} (${actionForm.scrapReason || 'no reason'})`;
        if (actionForm.notes) newLine += ` | Notes: ${actionForm.notes}`;
    }
    updates.notes = currentOrder.notes ? currentOrder.notes + '\n' + newLine : newLine;

    // Log Fab/Weld actions to wo_progress_events (fire-and-forget)
    if (isFabWeld) {
        insertProgressEvent({
            workOrderId:        id,
            woNumber:           currentOrder.wo_number || '',
            department:         currentOrder.department,
            stage:              null,
            operatorName:       opName,
            action:             newStatus,
            sessionQty:         sessionQty,
            cumulativeQtyAfter: updates.qty_completed || 0,
            reason:             actionForm.holdReason || ''
        });
    }

    // ── Time session tracking (fire-and-forget) ───────────────
    const prevStatus      = currentOrder.status;
    const activeStatuses  = ['started', 'resumed'];
    const closingStatuses = ['paused', 'on_hold', 'completed'];
    const openingStatuses = ['started', 'resumed'];

    if (openingStatuses.includes(overallStatus) && !activeStatuses.includes(prevStatus)) {
        supabase.from('wo_time_sessions').insert({
            wo_id:      id,
            wo_number:  currentOrder.wo_number || '',
            department: currentOrder.department,
            operator:   opName,
            started_at: now,
        }).then(({ error }) => {
            if (error) console.warn('wo_time_sessions open failed:', error.message);
        });
    } else if (closingStatuses.includes(overallStatus) && activeStatuses.includes(prevStatus)) {
        supabase.from('wo_time_sessions')
            .select('id, started_at')
            .eq('wo_id', id)
            .is('ended_at', null)
            .order('started_at', { ascending: false })
            .limit(1)
            .single()
            .then(({ data: session, error }) => {
                if (error || !session) return;
                const durationMinutes = Math.round(
                    (new Date(now) - new Date(session.started_at)) / 60000
                );
                supabase.from('wo_time_sessions').update({
                    ended_at:         now,
                    duration_minutes: durationMinutes,
                    end_status:       overallStatus,
                    qty_this_session: sessionQty,
                }).eq('id', session.id).then(({ error: e }) => {
                    if (e) console.warn('wo_time_sessions close failed:', e.message);
                });
            });
    }

    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// Undo: restore a previous snapshot of a work order
export async function restoreOrderSnapshot(id, previousData) {
    if (!id || !previousData) return { data: null, error: new Error('Missing undo data') };
    const restore = {
        status:                previousData.status,
        qty_completed:         previousData.qty_completed,
        operator:              previousData.operator,
        notes:                 previousData.notes,
        start_date:            previousData.start_date,
        comp_date:             previousData.comp_date,
        tc_pre_lap_status:     previousData.tc_pre_lap_status,
        tc_pre_lap_operator:   previousData.tc_pre_lap_operator,
        tc_final_status:       previousData.tc_final_status,
        tc_final_operator:     previousData.tc_final_operator,
        tc_packaging_status:   previousData.tc_packaging_status,
        tc_packaging_operator: previousData.tc_packaging_operator,
        tv_engine_status:      previousData.tv_engine_status,
        tv_cart_status:        previousData.tv_cart_status,
        tv_final_status:       previousData.tv_final_status,
        fab_bring_to:          previousData.fab_bring_to,
    };
    return withRetry(() =>
        supabase.from('work_orders').update(restore).eq('id', id).select()
    );
}

// insertManualWorkOrder — creates a new work order row for all departments.
export async function insertManualWorkOrder({ partNumber, description, qty, dept, woType, tcJobMode, salesOrder, unitSerial, engine, engineSerial, numBlades, customWoNumber }) {
    if (!partNumber) return { data: null, error: new Error('Part number is required') };
    if (!dept)       return { data: null, error: new Error('Department is required') };

    let woNumber;
    if (customWoNumber && customWoNumber.trim()) {
        woNumber = customWoNumber.trim().toUpperCase();
    } else {
        // Use timestamp-based suffix for collision avoidance
        woNumber = 'MANUAL-' + Date.now().toString(36).toUpperCase().slice(-5);
    }

    const row = {
        wo_number:     woNumber,
        part_number:   partNumber.trim().toUpperCase(),
        description:   (description || '').trim(),
        qty_required:  parseFloat(qty) || 1,
        qty_completed: 0,
        department:    dept,
        wo_type:       woType || 'Unit',
        status:        'not_started',
    };

    if (salesOrder)   row.sales_order            = salesOrder.trim();
    if (tcJobMode)    row.tc_job_mode            = tcJobMode;
    if (unitSerial)   row.unit_serial_number     = unitSerial.trim();
    if (engine)       row.engine                 = engine.trim();
    if (engineSerial) row.engine_serial_number   = engineSerial.trim();
    if (numBlades)    row.num_blades             = numBlades;

    return withRetry(() =>
        supabase.from('work_orders').insert([row]).select()
    );
}

// appendManagerNote — appends a timestamped note to work_orders.notes.
export async function appendManagerNote(id, existingNotes, authorName, noteContent) {
    if (!id)          return { data: null, error: new Error('Missing work order ID') };
    if (!authorName)  return { data: null, error: new Error('Author name is required') };
    if (!noteContent) return { data: null, error: new Error('Note content is required') };

    const timestamp = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit', hour12: true
    });
    const newLine  = `[${timestamp}] ${authorName.trim()}: ${noteContent.trim()}`;
    const combined = existingNotes ? existingNotes + '\n' + newLine : newLine;

    return withRetry(() =>
        supabase.from('work_orders').update({ notes: combined }).eq('id', id).select()
    );
}

// ── Progress event logging ────────────────────────────────────
// Fire-and-forget: inserts one row into wo_progress_events.
// Failures are logged to console only — never blocks the main action.
// Also imported by db-assy.js.
export async function insertProgressEvent({ workOrderId, woNumber, department, stage, operatorName, action, sessionQty, cumulativeQtyAfter, reason }) {
    try {
        await supabase.from('wo_progress_events').insert([{
            work_order_id:        workOrderId  || null,
            wo_number:            woNumber     || '',
            department:           department   || '',
            stage:                stage        || null,
            operator_name:        operatorName || '',
            action:               action       || '',
            session_qty:          parseFloat(sessionQty)         || 0,
            cumulative_qty_after: parseFloat(cumulativeQtyAfter) || 0,
            reason:               reason       || null
        }]);
    } catch (err) {
        console.warn('[insertProgressEvent] failed silently:', err);
    }
}
