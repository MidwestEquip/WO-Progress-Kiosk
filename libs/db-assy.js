// ============================================================
// libs/db-assy.js — TC (Tru Cut) Assy Supabase operations + unit completion helpers
//
// TV Assy functions live in db-tv.js.
// Imports withRetry from db-shared.js; activity helpers from db-activity.js.
//
// RULES: Same as db.js — no Vue, no state, no UI logic.
//        Every function returns { data, error } or throws.
// ============================================================

import { supabase } from './config.js';
import { withRetry } from './db-shared.js';
import { insertProgressEvent, openTimeSession, closeTimeSession, closeAllOpenSessions } from './db-activity.js';

// TC Assy: persist the job mode (unit|stock) for a WO
export async function saveTcJobMode(id, mode) {
    if (!id || !mode) return { data: null, error: new Error('Missing id or mode') };
    return withRetry(() =>
        supabase.from('work_orders').update({ tc_job_mode: mode }).eq('id', id).select()
    );
}

// TC Assy Unit: per-stage action with cumulative qty derived from notes history
export async function submitTcUnitStageAction({ id, currentOrder, stageKey, stagePrefix, newStatus, opName, sessionQty, reason, keepStatus }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const prefix    = stagePrefix + '|';
    const noteLines = (currentOrder.notes || '').split('\n');
    const stageLast = noteLines.filter(l => l.startsWith(prefix)).at(-1);
    const notesCum  = stageLast ? parseFloat(stageLast.split('|')[5]) || 0 : 0;
    const colVal    = currentOrder[stageKey + '_qty_completed'];
    const prevCum   = colVal != null ? parseFloat(colVal) || 0 : notesCum;
    const session   = parseFloat(sessionQty) || 0;
    const newCum    = Math.max(0, prevCum + session);

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    const updates = {};
    if (!keepStatus) {
        updates[stageKey + '_status']   = newStatus;
        updates[stageKey + '_operator'] = opName;
        updates.operator = opName;

        // Recompute overall WO status from 2 TC stages
        const pre = stageKey === 'tc_pre_lap' ? newStatus : (currentOrder.tc_pre_lap_status || '');
        const fin = stageKey === 'tc_final'   ? newStatus : (currentOrder.tc_final_status   || '');
        if      (fin === 'completed')                    updates.status = 'completed';
        else if (pre === 'started' || fin === 'started') updates.status = 'started';
        else if (pre === 'paused'  || fin === 'paused')  updates.status = 'paused';
        else if (pre === 'on_hold' || fin === 'on_hold') updates.status = 'on_hold';
        else                                              updates.status = currentOrder.status || newStatus;

        if (newStatus === 'started'   && !currentOrder.start_date) updates.start_date = now;
        if (newStatus === 'completed' && stageKey === 'tc_final')   updates.comp_date  = now;
    }

    // Update TC stage cumulative qty column in work_orders
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
            department:          'Tru Cut Assy',
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
                    department: 'Tru Cut Assy', operator: opName, stage: stageKey,
                });
            } else if (newStatus === 'paused' || newStatus === 'on_hold' || newStatus === 'completed') {
                closeTimeSession({ woId: id, stage: stageKey, endStatus: newStatus, sessionQty: session });
            }
        }
    }

    return result;
}

// TC Assy Unit: mark whole WO complete regardless of stage completion
export async function completeTcWo({ id, currentOrder, opName, unitFields, notes: addNotes }) {
    if (!id)     return { data: null, error: new Error('Missing WO ID') };
    if (!opName) return { data: null, error: new Error('Operator required') };

    const now = new Date().toISOString();
    const ts  = new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: '2-digit',
        hour: 'numeric', minute: '2-digit'
    });

    // Standard completion log line
    const histLine = `TCWOC|${ts}|${opName}|WO completed (manual)|||`;
    const notes    = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;

    const updateObj = {
        status:        'completed',
        qty_completed: currentOrder.qty_required || 0,
        comp_date:     now,
        operator:      opName,
        notes
    };

    if (unitFields) {
        Object.assign(updateObj, unitFields);
    }
    if (addNotes && addNotes.trim() !== '') {
        updateObj.tc_assy_notes_differences_mods = addNotes.trim();
    }

    const result = await withRetry(() =>
        supabase.from('work_orders').update(updateObj).eq('id', id).select()
    );

    if (!result.error) {
        insertProgressEvent({
            workOrderId:         id,
            woNumber:            currentOrder.wo_number || '',
            jobNumber:           currentOrder.job_number || null,
            department:          'Tru Cut Assy',
            stage:               null,
            operatorName:        opName,
            action:              'WO completed (manual)',
            sessionQty:          0,
            cumulativeQtyAfter:  currentOrder.qty_required || 0,
            reason:              ''
        });
        closeAllOpenSessions({ woId: id, endStatus: 'completed', sessionQty: 0 });
    }

    return result;
}

// Save unit detail fields on the TC Unit workflow screen (any time, not just at completion)
// All fields optional — only non-undefined values are written.
export async function saveTcUnitInfo(id, fields) {
    if (!id) return { data: null, error: new Error('Missing WO ID') };
    const updates = {
        sales_order:                    fields.salesOrder   || null,
        unit_serial_number:             fields.unitSerial   || null,
        engine:                         fields.engine       || null,
        engine_serial_number:           fields.engineSerial || null,
        num_blades:                     fields.numBlades    || null,
        tc_assy_notes_differences_mods: fields.notes        || null,
    };
    return withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );
}

// saveTcAssyNotes — saves TC Assy notes/mods text. Input: WO id, notes string.
export async function saveTcAssyNotes(id, notes) {
    if (!id) return { data: null, error: new Error('Missing WO ID') };
    return withRetry(() =>
        supabase.from('work_orders')
            .update({ tc_assy_notes_differences_mods: notes && notes.trim() ? notes.trim() : null })
            .eq('id', id)
            .select()
    );
}

// TC Assy Stock: write one action entry, additive qty, structured history
export async function submitTcStockAction({ id, currentOrder, newStatus, opName, sessionQty, reason, keepStatus, notes = '' }) {
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
    // Pipe-delimited history line: TCST|ts|operator|action|sessionQty|cumQty|reason
    const histLine = `TCST|${ts}|${opName}|${actionLabel}|${sessionStr}|${cumStr}|${reason || ''}`;
    updates.notes = currentOrder.notes ? currentOrder.notes + '\n' + histLine : histLine;
    if (newStatus === 'completed' && notes && notes.trim()) {
        updates.tc_assy_notes_differences_mods = notes.trim();
    }

    const result = await withRetry(() =>
        supabase.from('work_orders').update(updates).eq('id', id).select()
    );

    if (!result.error) {
        insertProgressEvent({
            workOrderId:         id,
            woNumber:            currentOrder.wo_number || '',
            jobNumber:           currentOrder.job_number || null,
            department:          'Tru Cut Assy',
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
                    department: 'Tru Cut Assy', operator: opName, stage: 'stock',
                });
            } else if (newStatus === 'paused' || newStatus === 'on_hold' || newStatus === 'completed') {
                closeTimeSession({ woId: id, stage: 'stock', endStatus: newStatus, sessionQty: session });
            }
        }
    }

    return result;
}

// ── Unit Completions ──────────────────────────────────────────

// recordUnitCompletion — inserts one row into wo_unit_completions for a single unit.
// unitData: { unitSerial, engineModel, engineSerial, numBlades, operator }
export async function recordUnitCompletion(woId, woNumber, dept, unitNumber, unitData, jobNumber = null) {
    if (!woNumber) return { data: null, error: new Error('Missing WO number') };
    return withRetry(() =>
        supabase.from('wo_unit_completions').insert([{
            wo_id:                woId      || null,
            wo_number:            woNumber.trim().toUpperCase(),
            job_number:           jobNumber || null,
            department:           dept,
            unit_number:          unitNumber,
            unit_serial_number:   (unitData.unitSerial   || '').trim() || null,
            engine_model:         (unitData.engineModel  || '').trim() || null,
            engine_serial_number: (unitData.engineSerial || '').trim() || null,
            num_blades:           unitData.numBlades ? parseInt(unitData.numBlades) : null,
            operator:             (unitData.operator     || '').trim() || null,
            completed_at:         new Date().toISOString(),
        }]).select()
    );
}

// fetchUnitCompletions — all wo_unit_completions rows for a given WO number, ordered by unit_number.
export async function fetchUnitCompletions(woNumber) {
    if (!woNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('wo_unit_completions')
            .select('*')
            .eq('wo_number', woNumber.trim().toUpperCase())
            .order('unit_number', { ascending: true })
    );
}

// searchUnitsBySerial — finds wo_unit_completions rows matching a serial number (exact or partial).
// Used by CS view for serial # lookup.
export async function searchUnitsBySerial(serial) {
    if (!serial) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('wo_unit_completions')
            .select('*')
            .ilike('unit_serial_number', '%' + serial.trim() + '%')
            .order('completed_at', { ascending: false })
            .limit(50)
    );
}
