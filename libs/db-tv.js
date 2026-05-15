// ============================================================
// libs/db-tv.js — TV (Trac Vac) Assy Supabase operations
//
// Split from db-assy.js to keep files under ~500 lines.
// Imports withRetry from db-shared.js; activity helpers from db-activity.js.
//
// RULES: Same as db.js — no Vue, no state, no UI logic.
//        Every function returns { data, error } or throws.
// ============================================================

import { supabase } from './config.js';
import { withRetry } from './db-shared.js';
import { insertProgressEvent, openTimeSession, closeTimeSession, closeAllOpenSessions } from './db-activity.js';

// TV Assy: persist the job mode (unit|stock) for a WO so the user never has to re-select
export async function saveTvJobMode(id, mode) {
    if (!id || !mode) return { data: null, error: new Error('Missing id or mode') };
    return withRetry(() =>
        supabase.from('work_orders').update({ tv_job_mode: mode }).eq('id', id).select()
    );
}

// TV Assy Unit: per-stage action with cumulative qty derived from notes history
export async function submitTvUnitStageAction({ id, currentOrder, stageKey, stagePrefix, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const prefix    = stagePrefix + '|';
    const noteLines = (currentOrder.notes || '').split('\n');
    const stageLast = noteLines.filter(l => l.startsWith(prefix)).at(-1);
    const notesCum  = stageLast ? parseFloat(stageLast.split('|')[5]) || 0 : 0;
    const colVal    = currentOrder[stageKey + '_qty_completed'];
    const prevCum   = colVal != null ? parseFloat(colVal) || 0 : notesCum;
    const session   = parseFloat(sessionQty) || 0;
    const newCum   = Math.max(0, prevCum + session);

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates[stageKey + '_status'] = newStatus;
        updates.operator = opName;

        // Recompute overall WO status from all 3 TV stages
        const eng = stageKey === 'tv_engine' ? newStatus : (currentOrder.tv_engine_status || '');
        const crt = stageKey === 'tv_cart'   ? newStatus : (currentOrder.tv_cart_status   || '');
        const fin = stageKey === 'tv_final'  ? newStatus : (currentOrder.tv_final_status  || '');

        if      (fin === 'completed')                                          updates.status = 'completed';
        else if (eng === 'started' || crt === 'started' || fin === 'started') updates.status = 'started';
        else if (eng === 'paused'  || crt === 'paused'  || fin === 'paused')  updates.status = 'paused';
        else if (eng === 'on_hold' || crt === 'on_hold')                       updates.status = 'on_hold';
        else                                                                    updates.status = currentOrder.status || newStatus;

        if (newStatus === 'started'   && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed' && stageKey === 'tv_final')  updates.comp_date  = now;
    }

    // Update TV stage cumulative qty column in work_orders
    if (!keepStatus && session !== 0) updates[stageKey + '_qty_completed'] = newCum;

    const actionLabel = keepStatus ? "can't start" : newStatus;
    const sessionStr  = (!keepStatus && session !== 0)
        ? (session > 0 ? '+' + session : String(session)) : '';
    const cumStr      = keepStatus ? String(prevCum) : String(newCum);
    const histLine    = `${stagePrefix}|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes     = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    const result = await withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );

    if (!result.error) {
        insertProgressEvent({
            workOrderId:         id,
            woNumber:            currentOrder.wo_number || '',
            jobNumber:           currentOrder.job_number || null,
            department:          'Trac Vac Assy',
            stage:               stageKey,
            operatorName:        opName,
            action:              keepStatus ? "can't start" : newStatus,
            sessionQty:          session,
            cumulativeQtyAfter:  keepStatus ? prevCum : newCum,
            reason:              reason || ''
        });

        if (!keepStatus) {
            if (newStatus === 'started') {
                openTimeSession({
                    woId: id, woNumber: currentOrder.wo_number || '',
                    jobNumber: currentOrder.job_number || null,
                    department: 'Trac Vac Assy', operator: opName, stage: stageKey,
                });
            } else if (newStatus === 'paused' || newStatus === 'on_hold' || newStatus === 'completed') {
                closeTimeSession({ woId: id, stage: stageKey, endStatus: newStatus, sessionQty: session });
            }
        }
    }

    return result;
}

// TV Assy Stock: write one action entry, additive qty, structured history
export async function submitTvStockAction({ id, currentOrder, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator name required') };

    const prevQty  = parseFloat(currentOrder.qty_completed) || 0;
    const session  = parseFloat(sessionQty) || 0;
    const newCum   = Math.max(0, prevQty + session);
    const now      = new Date().toISOString();
    const ts       = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates.status        = newStatus;
        updates.qty_completed = newCum;
        updates.operator      = opName;
        if (newStatus === 'started' && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed') updates.comp_date = now;
    }

    const actionLabel = keepStatus ? "can't start" : newStatus;
    const sessionStr  = (!keepStatus && session !== 0)
        ? (session > 0 ? '+' + session : String(session)) : '';
    const cumStr      = keepStatus ? String(prevQty) : String(newCum);
    // Pipe-delimited history line: TVST|ts|operator|action|sessionQty|cumQty|reason
    const histLine = `TVST|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    const result = await withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );

    if (!result.error) {
        insertProgressEvent({
            workOrderId:         id,
            woNumber:            currentOrder.wo_number || '',
            jobNumber:           currentOrder.job_number || null,
            department:          'Trac Vac Assy',
            stage:               'stock',
            operatorName:        opName,
            action:              keepStatus ? "can't start" : newStatus,
            sessionQty:          session,
            cumulativeQtyAfter:  keepStatus ? prevQty : newCum,
            reason:              reason || ''
        });

        if (!keepStatus) {
            if (newStatus === 'started') {
                openTimeSession({
                    woId: id, woNumber: currentOrder.wo_number || '',
                    jobNumber: currentOrder.job_number || null,
                    department: 'Trac Vac Assy', operator: opName, stage: 'stock',
                });
            } else if (newStatus === 'paused' || newStatus === 'on_hold' || newStatus === 'completed') {
                closeTimeSession({ woId: id, stage: 'stock', endStatus: newStatus, sessionQty: session });
            }
        }
    }

    return result;
}

// completeTvUnitWo — marks a TV Unit WO complete regardless of stage status.
// Sets status='completed', appends TVWOC history line, closes open time sessions.
export async function completeTvUnitWo({ id, currentOrder, opName }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });
    const histLine = `TVWOC|${ts}|${opName}|WO completed (manual)|||`;
    const notes    = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    const result = await withRetry(() =>
        supabase.from('work_orders').update({
            status:        'completed',
            qty_completed: currentOrder.qty_required || 0,
            comp_date:     now,
            operator:      opName,
            notes
        }).eq('id', id).select()
    );

    if (!result.error) {
        insertProgressEvent({
            workOrderId:        id,
            woNumber:           currentOrder.wo_number || '',
            jobNumber:          currentOrder.job_number || null,
            department:         'Trac Vac Assy',
            stage:              null,
            operatorName:       opName,
            action:             'WO completed (manual)',
            sessionQty:         0,
            cumulativeQtyAfter: currentOrder.qty_required || 0,
            reason:             ''
        });
        closeAllOpenSessions({ woId: id, endStatus: 'completed', sessionQty: 0 });
    }

    return result;
}

// saveTvUnitInfo — writes unit serial, engine model, and engine serial to work_orders for a TV Unit WO.
// Input: id (WO id), unitSerial, engineModel, engineSerial strings.
export async function saveTvUnitInfo(id, unitSerial, engineModel, engineSerial) {
    if (!id) return { data: null, error: new Error('Missing WO ID') };
    return withRetry(() =>
        supabase.from('work_orders').update({
            unit_serial_number:   unitSerial.trim()   || null,
            engine:               engineModel.trim()  || null,
            engine_serial_number: engineSerial.trim() || null,
        }).eq('id', id).select()
    );
}

// saveTvAssyNotes — saves TV Assy notes/mods text. Input: WO id, notes string.
export async function saveTvAssyNotes(id, notes) {
    if (!id) return { data: null, error: new Error('Missing WO ID') };
    return withRetry(() =>
        supabase.from('work_orders')
            .update({ tv_assy_notes: notes && notes.trim() ? notes.trim() : null })
            .eq('id', id)
            .select()
    );
}
