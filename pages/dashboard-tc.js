// ============================================================
// pages/dashboard-tc.js — TC (Tru Cut) Assy workflow logic
//
// Handles: mode resolution, unit stages, stock workflow,
//          hold flows, notes, unit details, completion gate.
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import * as dbAssy from '../libs/db-assy.js';
import { fetchDraftUnitCompletions, upsertUnitDraft } from '../libs/db-assy.js';
import { isNonEmpty, detectTcMode, deepClone } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// ── loadWoFiles ───────────────────────────────────────────────
// Local copy — page files may not import from other page files.
async function loadWoFiles(partNumber) {
    if (!partNumber) { store.woFiles.value = []; return; }
    store.woFilesLoading.value = true;
    const { data, error } = await db.listWoFiles(partNumber);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Could not load files: ' + error.message); return; }
    store.woFiles.value = data || [];
}

// ── tcUnitOpenHold ────────────────────────────────────────────
// Opens the sidebar hold form for the currently active TC unit stage.
export function tcUnitOpenHold() {
    store.tcUnitHoldOpen.value        = true;
    store.tcUnitHoldReason.value      = '';
    store.tcUnitHoldReasonError.value = false;
}

// ── tcUnitConfirmHold ─────────────────────────────────────────
// Validates reason and submits hold for the active TC unit stage.
export async function tcUnitConfirmHold() {
    if (!store.tcUnitHoldReason.value.trim()) {
        store.tcUnitHoldReasonError.value = true;
        return;
    }
    const order = store.activeOrder.value;
    const stageName = order.tc_pre_lap_status === 'started' ? 'prelap'
                    : order.tc_final_status   === 'started' ? 'final'
                    : null;
    if (!stageName) { store.tcUnitHoldOpen.value = false; return; }
    const stageRef = stageName === 'prelap' ? store.tcPreStage : store.tcFinStage;
    stageRef.value.pending = 'hold';
    stageRef.value.reason  = store.tcUnitHoldReason.value;
    store.tcUnitHoldOpen.value = false;
    await submitTcUnitStageFromUi(stageName);
}

// ── openTcAssyEntry ───────────────────────────────────────────
// Always skips the entry modal and goes directly to the workflow screen.
// Mode resolution: saved tc_job_mode → detectTcMode(part#) → 'stock' default.
// If no operator is saved, opens the inline name editor automatically.
export function openTcAssyEntry(order) {
    const mode = order.tc_job_mode || detectTcMode(order.part_number) || 'stock';
    store.tcAssyEntryName.value = order.operator || '';
    if (mode === 'unit') openTcAssyUnit(order);
    else                 openTcAssyStock(order);
    // Set AFTER openTcAssyUnit/Stock — they both reset opEditing to false
    store.tcAssyOpEditing.value = !order.operator;
}

// ── toggleTcEntryMode ─────────────────────────────────────────
// Flips the user override in the entry modal between unit and stock.
export function toggleTcEntryMode() {
    const current = store.tcEntryMode.value;
    store.tcEntryModeOverride.value = current === 'unit' ? 'stock' : 'unit';
}

// tcAssyContinue — called from the TC entry name step; routes to appropriate workflow.
export function tcAssyContinue(mode) {
    if (!store.tcAssyEntryName.value.trim()) {
        store.tcAssyNameError.value = true;
        return;
    }
    store.tcAssyNameError.value = false;
    const order = store.activeOrder.value;
    if (mode === 'unit')  openTcAssyUnit(order);
    else                  openTcAssyStock(order);
}

// ── openTcAssyUnit ────────────────────────────────────────────
// Opens the TC Unit workflow screen; resets stage pending states and restores draft units.
export async function openTcAssyUnit(order) {
    store.activeOrder.value     = order;
    store.tcAssyJobType.value   = 'unit';
    store.tcAssyEntryOpen.value = false;
    store.tcAssyUnitOpen.value  = true;
    store.tcAssyOpEditing.value = false;
    loadWoFiles(order.part_number);
    const _blank = { pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false };
    store.tcPreStage.value = { ..._blank };
    store.tcFinStage.value = { ..._blank };
    // Default unit #1 from order fields while fetch is in-flight
    store.tcUnitDetailList.value = [{
        salesOrder:   order.sales_order || '',
        unitSerial:   order.unit_serial_number || '',
        engineModel:  order.engine || '',
        engineSerial: order.engine_serial_number || '',
        numBlades:    String(order.num_blades || ''),
        notes:        '',
    }];
    store.tcUnitNotes.value     = order.tc_assy_notes_differences_mods || '';
    store.tcUnitListError.value = false;
    // For completed WOs fetch all rows (incl. stamped); for active WOs fetch drafts only.
    const { data } = order.status === 'completed'
        ? await dbAssy.fetchUnitCompletionsByWorkOrderId(order.id)
        : await fetchDraftUnitCompletions(order.id);
    if (data && data.length > 0) {
        store.tcUnitDetailList.value = data.map(r => ({
            salesOrder:   r.unit_number === 1 ? (order.sales_order || '') : '',
            unitSerial:   r.unit_serial_number || '',
            engineModel:  r.engine_model || '',
            engineSerial: r.engine_serial_number || '',
            numBlades:    String(r.num_blades || ''),
            notes:        r.unit_notes || '',
        }));
    }
    // Persist mode on first selection
    if (!order.tc_job_mode) {
        dbAssy.saveTcJobMode(order.id, 'unit').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

// ── addTcUnit / removeTcUnit ──────────────────────────────────
// Adds a blank unit entry or removes one (min 1 unit always kept).
export function addTcUnit() {
    store.tcUnitDetailList.value = [
        ...store.tcUnitDetailList.value,
        { salesOrder: '', unitSerial: '', engineModel: '', engineSerial: '', numBlades: '', notes: '' }
    ];
}
export function removeTcUnit(idx) {
    if (store.tcUnitDetailList.value.length <= 1) return;
    store.tcUnitDetailList.value = store.tcUnitDetailList.value.filter((_, i) => i !== idx);
}

// ── saveTcUnitDetails ─────────────────────────────────────────
// Upserts each unit as a draft row (keyed on work_order_id) on blur; surfaces a toast on failure.
export async function saveTcUnitDetails() {
    const order    = store.activeOrder.value;
    if (!order) return;
    const operator = store.tcAssyEntryName.value.trim();
    try {
        const results = await Promise.all(
            store.tcUnitDetailList.value.map((u, idx) =>
                upsertUnitDraft(order.id, order.wo_number, 'Tru Cut Assy', idx + 1, { ...u, operator }, order.job_number || null)
            )
        );
        const failed = results.find(r => r?.error);
        if (failed) {
            store.showToast("Couldn't save unit details — check your connection and try again.", 'error');
            logError('saveTcUnitDetails', failed.error, { id: order.id });
        }
    } catch (err) {
        store.showToast("Couldn't save unit details — check your connection and try again.", 'error');
        logError('saveTcUnitDetails', err, { id: order.id });
    }
}

// ── openTcAssyStock ───────────────────────────────────────────
// Opens the TC Subassy workflow screen.
export function openTcAssyStock(order) {
    store.activeOrder.value        = order;
    store.tcAssyJobType.value      = 'stock';
    store.tcAssyEntryOpen.value    = false;
    store.tcAssyStockOpen.value    = true;
    store.tcAssyOpEditing.value    = false;
    loadWoFiles(order.part_number);
    store.tcStockPending.value     = '';
    store.tcStockSessionQty.value  = '';
    store.tcStockReason.value      = '';
    store.tcStockQtyError.value    = false;
    store.tcStockReasonError.value = false;
    store.tcStockNotes.value       = order.tc_assy_notes_differences_mods || '';
    // Persist mode on first selection
    if (!order.tc_job_mode) {
        dbAssy.saveTcJobMode(order.id, 'stock').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

// ── submitTcStockActionFromUi ─────────────────────────────────
// Validates and submits a TC Subassy action.
export async function submitTcStockActionFromUi() {
    const order      = store.activeOrder.value;
    const pending    = store.tcStockPending.value;
    const operator   = store.tcAssyEntryName.value;
    const sessionQty = store.tcStockSessionQty.value;
    const reason     = store.tcStockReason.value.trim();
    const notes      = pending === 'complete' ? store.tcStockNotes.value.trim() : '';

    store.tcStockQtyError.value    = false;
    store.tcStockReasonError.value = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        store.tcStockQtyError.value = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        store.tcStockReasonError.value = true; hasError = true;
    }
    if (hasError) return;

    const STATUS_MAP = { start: 'started', pause: 'paused', resume: 'started', complete: 'completed', hold: 'on_hold', cant_start: null };
    const keepStatus = pending === 'cant_start';

    const previousSnapshot = deepClone(order);
    store.loading.value = true;
    try {
        const result = await dbAssy.submitTcStockAction({
            id:           order.id,
            currentOrder: order,
            newStatus:    STATUS_MAP[pending],
            opName:       operator,
            sessionQty:   (pending === 'pause' || pending === 'complete') ? parseFloat(sessionQty) : 0,
            reason,
            keepStatus,
            notes
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.tcStockPending.value    = '';
        store.tcStockSessionQty.value = '';
        store.tcStockReason.value     = '';
        store.tcStockNotes.value      = updated.tc_assy_notes_differences_mods || '';
        store.showToast('Action recorded', 'success');
        store.lastUndoAction.value = {
            id: order.id, previousData: previousSnapshot,
            description: `TC stock ${pending} — WO ${order.wo_number}`,
            dept: store.selectedDept.value
        };
        if (updated.status === 'completed') await db.autoReceiveAssyWo(updated, operator);
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('submitTcStockActionFromUi', err, { id: store.activeOrder.value?.id, pending });
    } finally {
        store.loading.value = false;
    }
}

// ── saveTcStockNotes ──────────────────────────────────────────
// Saves the notes/differences/mods textarea on the TC Subassy screen.
export async function saveTcStockNotes() {
    const order = store.activeOrder.value;
    if (!order) return;
    store.loading.value = true;
    try {
        const result = await dbAssy.saveTcAssyNotes(order.id, store.tcStockNotes.value);
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('Notes saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save notes: ' + err.message);
        logError('saveTcStockNotes', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── submitTcUnitStageFromUi ───────────────────────────────────
// Validates and submits a TC Unit stage action.
// Input: stageName = 'prelap' | 'final'
export async function submitTcUnitStageFromUi(stageName) {
    const stageRef   = stageName === 'prelap' ? store.tcPreStage : store.tcFinStage;
    const stageKey   = stageName === 'prelap' ? 'tc_pre_lap' : 'tc_final';
    const prefix     = stageName === 'prelap' ? 'TCPRE' : 'TCFIN';
    const order      = store.activeOrder.value;
    const pending    = stageRef.value.pending;
    const operator   = store.tcAssyEntryName.value;
    const sessionQty = stageRef.value.sessionQty;
    const reason     = stageRef.value.reason.trim();

    stageRef.value.qtyError    = false;
    stageRef.value.reasonError = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        stageRef.value.qtyError = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        stageRef.value.reasonError = true; hasError = true;
    }
    if (hasError) return;

    // Gate final-stage completion on unit details for unit WOs
    if (stageName === 'final' && pending === 'complete' && order.tc_job_mode === 'unit') {
        const incomplete = store.tcUnitDetailList.value.some(u =>
            !u.unitSerial.trim() || !u.engineModel.trim() || !u.engineSerial.trim() || !String(u.numBlades).trim()
        );
        if (incomplete) {
            store.tcUnitListError.value = true;
            store.showToast('Fill in Unit Serial #, Engine, Engine Serial #, and # of Blades for all units before completing.', 'error');
            return;
        }
        store.tcUnitListError.value = false;
    }

    const STATUS_MAP = { start: 'started', pause: 'paused', resume: 'started', complete: 'completed', hold: 'on_hold', cant_start: null };
    const keepStatus = pending === 'cant_start';

    const previousSnapshot = deepClone(order);
    store.loading.value = true;
    try {
        const result = await dbAssy.submitTcUnitStageAction({
            id:           order.id,
            currentOrder: order,
            stageKey,
            stagePrefix:  prefix,
            newStatus:    STATUS_MAP[pending],
            opName:       operator,
            sessionQty:   (pending === 'pause' || pending === 'complete') ? parseFloat(sessionQty) : 0,
            reason,
            keepStatus
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        stageRef.value.pending    = '';
        stageRef.value.sessionQty = '';
        stageRef.value.reason     = '';
        store.showToast('Stage action recorded', 'success');
        store.lastUndoAction.value = {
            id: order.id, previousData: previousSnapshot,
            description: `TC ${stageName} ${STATUS_MAP[pending] || 'can\'t start'} — WO ${order.wo_number}`,
            dept: store.selectedDept.value
        };
        // On final-stage complete for unit WOs: record each unit and auto-receive
        if (stageName === 'final' && pending === 'complete' && order.tc_job_mode === 'unit') {
            const units = store.tcUnitDetailList.value;
            units.forEach((u, idx) => {
                dbAssy.recordUnitCompletion(updated.id, updated.wo_number, 'Tru Cut Assy', idx + 1, {
                    unitSerial:   u.unitSerial,
                    engineModel:  u.engineModel,
                    engineSerial: u.engineSerial,
                    numBlades:    u.numBlades,
                    notes:        u.notes,
                    operator,
                }, updated.job_number || null);
            });
            await db.autoReceiveAssyWo(updated, operator);
        }
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('submitTcUnitStageFromUi', err, { id: store.activeOrder.value?.id, stageName });
    } finally {
        store.loading.value = false;
    }
}

// tcStockDirectAction — start or resume TC Subassy immediately without a confirm step.
// Input: action = 'start'|'resume'
export async function tcStockDirectAction(action) {
    store.tcStockPending.value = action;
    await submitTcStockActionFromUi();
}

// tcUnitStageDirectAction — start or resume a TC Unit stage immediately without a confirm step.
// Input: stageName = 'prelap'|'final', action = 'start'|'resume'
export async function tcUnitStageDirectAction(stageName, action) {
    const stageRef = stageName === 'prelap' ? store.tcPreStage : store.tcFinStage;
    stageRef.value.pending = action;
    await submitTcUnitStageFromUi(stageName);
}

// ── openTcAssyCompleteModal ───────────────────────────────────
// Validates unit fields (unit mode) then opens the confirm modal.
export function openTcAssyCompleteModal() {
    const order    = store.activeOrder.value;
    const operator = store.tcAssyEntryName.value.trim();
    if (!operator) {
        store.showToast('Enter your name before completing the WO.', 'error');
        return;
    }
    if (order.tc_job_mode === 'unit') {
        const incomplete = store.tcUnitDetailList.value.some(u =>
            !u.unitSerial.trim() || !u.engineModel.trim() || !u.engineSerial.trim() || !String(u.numBlades).trim()
        );
        if (incomplete) {
            store.tcUnitListError.value = true;
            store.showToast('Unit Serial #, Engine, Engine Serial #, and # of Blades are required for all units.', 'error');
            return;
        }
        store.tcUnitListError.value = false;
    }
    store.tcAssyCompleteModalOpen.value = true;
}

// ── confirmTcWoComplete ───────────────────────────────────────
// Marks TC WO complete; records each entry in tcUnitDetailList to wo_unit_completions.
export async function confirmTcWoComplete() {
    const order    = store.activeOrder.value;
    const operator = store.tcAssyEntryName.value.trim();
    const isUnit   = order.tc_job_mode === 'unit';

    const previousSnapshot = deepClone(order);
    store.loading.value = true;
    try {
        const units = store.tcUnitDetailList.value;
        const u0    = units[0] || {};
        const unitFields = isUnit ? {
            sales_order:          u0.salesOrder || null,
            unit_serial_number:   u0.unitSerial || null,
            engine:               u0.engineModel || null,
            engine_serial_number: u0.engineSerial || null,
            num_blades:           u0.numBlades || null,
        } : null;

        const result = await dbAssy.completeTcWo({
            id:           order.id,
            currentOrder: order,
            opName:       operator,
            unitFields,
            notes:        store.tcUnitNotes.value.trim()
        });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('WO marked complete', 'success');
        store.lastUndoAction.value = {
            id: order.id, previousData: previousSnapshot,
            description: `TC WO complete — ${order.wo_number}`,
            dept: store.selectedDept.value
        };
        store.tcAssyCompleteModalOpen.value = false;

        if (isUnit) {
            units.forEach((u, idx) => {
                dbAssy.recordUnitCompletion(updated.id, updated.wo_number, 'Tru Cut Assy', idx + 1, {
                    unitSerial:   u.unitSerial,
                    engineModel:  u.engineModel,
                    engineSerial: u.engineSerial,
                    numBlades:    u.numBlades,
                    notes:        u.notes,
                    operator,
                }, updated.job_number || null);
            });
        }

        await db.autoReceiveAssyWo(updated, operator);
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('confirmTcWoComplete', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
}
