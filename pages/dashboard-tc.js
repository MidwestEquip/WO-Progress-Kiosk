// ============================================================
// pages/dashboard-tc.js — TC (Tru Cut) Assy workflow logic
//
// Handles: mode resolution, unit stages, stock workflow,
//          hold flows, notes, unit details, completion gate.
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import * as dbAssy from '../libs/db-assy.js';
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
// Opens the TC Unit workflow screen; resets all stage pending states.
export function openTcAssyUnit(order) {
    store.activeOrder.value     = order;
    store.tcAssyJobType.value   = 'unit';
    store.tcAssyEntryOpen.value = false;
    store.tcAssyUnitOpen.value  = true;
    store.tcAssyOpEditing.value = false;
    loadWoFiles(order.part_number);
    const _blank = { pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false };
    store.tcPreStage.value = { ..._blank };
    store.tcFinStage.value = { ..._blank };
    store.tcUnitInfoForm.value = {
        salesOrder:   order.sales_order                    || '',
        unitSerial:   order.unit_serial_number             || '',
        engine:       order.engine                         || '',
        engineSerial: order.engine_serial_number           || '',
        numBlades:    order.num_blades                     || '',
        notes:        order.tc_assy_notes_differences_mods || '',
    };
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

// ── saveTcUnitDetails ─────────────────────────────────────────
// Saves all unit info fields from the TC Unit workflow screen.
export async function saveTcUnitDetails() {
    const order = store.activeOrder.value;
    if (!order) return;
    store.loading.value = true;
    try {
        const result = await dbAssy.saveTcUnitInfo(order.id, store.tcUnitInfoForm.value);
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('Details saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save details: ' + err.message);
        logError('saveTcUnitDetails', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
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
// Opens the TC WO completion gate modal. For qty>1 initialises step-through state.
export function openTcAssyCompleteModal() {
    const order    = store.activeOrder.value;
    const operator = store.tcAssyEntryName.value.trim();
    if (!operator) {
        store.showToast('Enter your name before completing the WO.', 'error');
        return;
    }
    const qty = parseInt(order.qty_required) || 1;
    store.tcUnitTotal.value     = qty;
    store.tcUnitStep.value      = 1;
    store.tcUnitStepError.value = false;
    store.tcUnitForms.value = Array.from({ length: qty }, (_, i) => ({
        unitSerial:   i === 0 ? (order.unit_serial_number   || '') : '',
        engineModel:  i === 0 ? (order.engine               || '') : '',
        engineSerial: i === 0 ? (order.engine_serial_number || '') : '',
        numBlades:    i === 0 ? (String(order.num_blades    || '')) : '',
    }));
    store.tcAssyCompleteForm.value = {
        salesOrder: order.sales_order || '',
        notes:      ''
    };
    store.tcAssyCompleteErrors.value = { salesOrder: false };
    store.tcAssyCompleteModalOpen.value = true;
}

// tcUnitNextStep — validates current unit form then advances to the next step.
export function tcUnitNextStep() {
    const form = store.tcUnitForms.value[store.tcUnitStep.value - 1];
    if (!isNonEmpty(form.unitSerial) || !isNonEmpty(form.engineModel) ||
        !isNonEmpty(form.engineSerial) || !isNonEmpty(form.numBlades)) {
        store.tcUnitStepError.value = true;
        return;
    }
    store.tcUnitStepError.value = false;
    store.tcUnitStep.value++;
}

// ── confirmTcWoComplete ───────────────────────────────────────
// Validates and marks TC WO complete. Records per-unit completions to wo_unit_completions.
export async function confirmTcWoComplete() {
    const order    = store.activeOrder.value;
    const operator = store.tcAssyEntryName.value.trim();
    const form     = store.tcAssyCompleteForm.value;
    const errors   = store.tcAssyCompleteErrors.value;
    const isUnit   = order.tc_job_mode === 'unit';
    const isMulti  = store.tcUnitTotal.value > 1;

    if (isUnit) {
        errors.salesOrder = !isNonEmpty(form.salesOrder);
        // Validate the current (last) step's per-unit fields
        const cur = store.tcUnitForms.value[store.tcUnitStep.value - 1];
        store.tcUnitStepError.value = !isNonEmpty(cur.unitSerial) || !isNonEmpty(cur.engineModel) ||
            !isNonEmpty(cur.engineSerial) || !isNonEmpty(cur.numBlades);
        if (errors.salesOrder || store.tcUnitStepError.value) return;
    }

    const previousSnapshot = deepClone(order);
    store.loading.value = true;
    try {
        // For single-unit: write fields into work_orders for backward compat.
        // For multi-unit: only write sales_order; per-unit data lives in wo_unit_completions.
        const uf0 = store.tcUnitForms.value[0];
        const unitFields = isUnit ? {
            sales_order: form.salesOrder,
            ...(!isMulti && {
                unit_serial_number:   uf0.unitSerial,
                engine:               uf0.engineModel,
                engine_serial_number: uf0.engineSerial,
                num_blades:           uf0.numBlades,
            })
        } : null;

        const result = await dbAssy.completeTcWo({
            id:           order.id,
            currentOrder: order,
            opName:       operator,
            unitFields,
            notes:        form.notes
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

        // Record each unit in wo_unit_completions (fire-and-forget)
        if (isUnit) {
            store.tcUnitForms.value.forEach((uf, idx) => {
                dbAssy.recordUnitCompletion(updated.id, updated.wo_number, 'Tru Cut Assy', idx + 1, {
                    unitSerial:   uf.unitSerial,
                    engineModel:  uf.engineModel,
                    engineSerial: uf.engineSerial,
                    numBlades:    uf.numBlades,
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
