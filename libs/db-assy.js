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

// upsertUnitDraft — saves one unit as a draft row (action='unit_draft') in wo_progress_events.
// Delete+insert because Supabase upsert doesn't support partial unique indexes.
export async function upsertUnitDraft(woId, woNumber, dept, unitNumber, unitData, jobNumber = null) {
    if (!woId) return { data: null, error: new Error('Missing work order id') };
    const wn = (woNumber || '').trim().toUpperCase();
    await supabase.from('wo_progress_events')
        .delete()
        .eq('work_order_id', woId)
        .eq('unit_number', unitNumber)
        .eq('action', 'unit_draft');
    return withRetry(() =>
        supabase.from('wo_progress_events').insert([{
            work_order_id:        woId,
            wo_number:            wn,
            job_number:           jobNumber || null,
            department:           dept,
            action:               'unit_draft',
            unit_number:          unitNumber,
            unit_serial_number:   (unitData.unitSerial   || '').trim() || null,
            engine_model:         (unitData.engineModel  || unitData.engine || '').trim() || null,
            engine_serial_number: (unitData.engineSerial || '').trim() || null,
            num_blades:           unitData.numBlades ? parseInt(unitData.numBlades) : null,
            operator_name:        (unitData.operator     || '').trim() || null,
            unit_notes:           (unitData.notes        || '').trim() || null,
        }]).select()
    );
}

// fetchDraftUnitCompletions — fetches unit_draft rows for a WO from wo_progress_events.
// Keyed on work_order_id so drafts restore even before the official WO# exists.
export async function fetchDraftUnitCompletions(workOrderId) {
    if (!workOrderId) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('wo_progress_events')
            .select('unit_number,unit_serial_number,engine_model,engine_serial_number,num_blades,unit_notes,operator_name')
            .eq('work_order_id', workOrderId)
            .eq('action', 'unit_draft')
            .order('unit_number', { ascending: true })
    );
}

// deleteUnitRowsAbove — bounded cleanup of stray per-unit rows for a WO. Deletes rows of the given
// action ('unit_draft' | 'unit_completed') whose unit_number exceeds maxUnitNumber. Used to clear
// orphan rows left when the unit list shrinks (removed units) or a WO is re-completed with fewer units.
export async function deleteUnitRowsAbove(woId, maxUnitNumber, action) {
    if (!woId) return { data: null, error: new Error('Missing work order id') };
    return withRetry(() =>
        supabase.from('wo_progress_events')
            .delete()
            .eq('work_order_id', woId)
            .eq('action', action)
            .gt('unit_number', maxUnitNumber)
            .select()
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

// recordUnitCompletion — promotes an existing unit_draft (or already-completed) row to unit_completed
// in wo_progress_events, or inserts a unit_completed row if none exists for this unit_number.
// Idempotent: matching action IN (unit_draft, unit_completed) means re-completing a WO (e.g. after
// undo→redo) updates the existing row in place instead of inserting a duplicate.
export async function recordUnitCompletion(woId, woNumber, dept, unitNumber, unitData, jobNumber = null) {
    if (!woId) return { data: null, error: new Error('Missing work order id') };
    const wn = (woNumber || '').trim().toUpperCase();
    // Try to promote/refresh an existing draft OR completed row for this unit (in place)
    const upd = await withRetry(() =>
        supabase.from('wo_progress_events')
            .update({
                action:               'unit_completed',
                wo_number:            wn,
                job_number:           jobNumber || null,
                department:           dept,
                unit_serial_number:   (unitData.unitSerial   || '').trim() || null,
                engine_model:         (unitData.engineModel  || unitData.engine || '').trim() || null,
                engine_serial_number: (unitData.engineSerial || '').trim() || null,
                num_blades:           unitData.numBlades ? parseInt(unitData.numBlades) : null,
                operator_name:        (unitData.operator     || '').trim() || null,
                unit_notes:           (unitData.notes        || '').trim() || null,
            })
            .eq('work_order_id', woId)
            .eq('unit_number', unitNumber)
            .in('action', ['unit_draft', 'unit_completed'])
            .select()
    );
    if (!upd.error && upd.data?.length > 0) return upd;
    // Fallback: insert completed row if no draft existed
    return withRetry(() =>
        supabase.from('wo_progress_events').insert([{
            work_order_id:        woId,
            wo_number:            wn,
            job_number:           jobNumber || null,
            department:           dept,
            action:               'unit_completed',
            unit_number:          unitNumber,
            unit_serial_number:   (unitData.unitSerial   || '').trim() || null,
            engine_model:         (unitData.engineModel  || unitData.engine || '').trim() || null,
            engine_serial_number: (unitData.engineSerial || '').trim() || null,
            num_blades:           unitData.numBlades ? parseInt(unitData.numBlades) : null,
            operator_name:        (unitData.operator     || '').trim() || null,
            unit_notes:           (unitData.notes        || '').trim() || null,
        }]).select()
    );
}

// fetchUnitCompletions — all unit_completed rows for a given WO number from wo_progress_events.
// wo_number-keyed: used by CS lookback of ARCHIVED WOs, where the original work_orders
// row (and its id) no longer exists but wo_number survives in completed_work_orders.
export async function fetchUnitCompletions(woNumber) {
    if (!woNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('wo_progress_events')
            .select('unit_number,unit_serial_number,engine_model,engine_serial_number,num_blades,unit_notes,operator_name')
            .eq('wo_number', woNumber.trim().toUpperCase())
            .eq('action', 'unit_completed')
            .order('unit_number', { ascending: true })
    );
}

// fetchUnitCompletionsByWorkOrderId — unit_completed rows for a specific work_orders row.
// Used by the live dashboard (completed-but-not-archived WOs) and the closeout archive,
// where the work_orders row still exists. Keyed on work_order_id so per-unit data is found
// even when the WO was completed before its official WO# was assigned.
export async function fetchUnitCompletionsByWorkOrderId(workOrderId) {
    if (!workOrderId) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('wo_progress_events')
            .select('unit_number,unit_serial_number,engine_model,engine_serial_number,num_blades,unit_notes,operator_name')
            .eq('work_order_id', workOrderId)
            .eq('action', 'unit_completed')
            .order('unit_number', { ascending: true })
    );
}

// searchUnitCompletionsByTerm — finds wo_progress_events rows where unit_serial_number OR
// engine_serial_number matches the term (partial, case-insensitive).
export async function searchUnitCompletionsByTerm(term) {
    if (!term) return { data: [], error: null };
    const t = term.trim();
    return withRetry(() =>
        supabase.from('wo_progress_events')
            .select('wo_number,unit_serial_number,engine_serial_number')
            .in('action', ['unit_draft', 'unit_completed'])
            .or(`unit_serial_number.ilike.%${t}%,engine_serial_number.ilike.%${t}%`)
            .order('created_at', { ascending: false })
            .limit(100)
    );
}
