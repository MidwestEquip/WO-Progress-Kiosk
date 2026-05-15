// ============================================================
// pages/dashboard-tv.js — TV (Trac Vac) Assy workflow logic
//
// Handles: mode selection, unit stages, stock workflow,
//          hold flows, notes, auto-receive on completion.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import * as dbTv  from '../libs/db-tv.js';
import { recordUnitCompletion } from '../libs/db-assy.js';
import { deepClone } from '../libs/utils.js';
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

// ── openTvAssyEntry ───────────────────────────────────────────
// Routes to mode-select screen if tv_job_mode not yet saved;
// otherwise goes straight to the saved workflow screen.
export function openTvAssyEntry(order) {
    store.activeOrder.value     = order;
    store.tvAssyEntryName.value = order.operator || '';
    if (order.tv_job_mode) {
        if (order.tv_job_mode === 'unit') openTvAssyUnit(order);
        else                              openTvAssyStock(order);
    } else {
        store.tvModeSelectOpen.value = true;
    }
}

// tvSelectMode — called from the mode-select screen; saves mode and opens workflow.
// Input: mode = 'unit' | 'stock'
export function tvSelectMode(mode) {
    store.tvModeSelectOpen.value = false;
    const order = store.activeOrder.value;
    if (mode === 'unit') openTvAssyUnit(order);
    else                 openTvAssyStock(order);
}

// ── openTvAssyUnit ────────────────────────────────────────────
// Opens the TV Unit workflow screen; resets stage pending states and unit detail form.
export function openTvAssyUnit(order) {
    store.activeOrder.value      = order;
    store.tvAssyJobType.value    = 'unit';
    store.tvModeSelectOpen.value = false;
    store.tvAssyUnitOpen.value   = true;
    store.tvAssyOpEditing.value  = false;
    loadWoFiles(order.part_number);
    const blank = { pending: '', sessionQty: '', reason: '', qtyError: false, reasonError: false };
    store.tvEngStage.value = { ...blank };
    store.tvCrtStage.value = { ...blank };
    store.tvUnitHoldOpen.value        = false;
    store.tvUnitHoldReason.value      = '';
    store.tvUnitHoldReasonError.value = false;
    store.tvStockNotes.value          = order.tv_assy_notes || '';
    store.tvUnitInfoForm.value = {
        unitSerial:   order.unit_serial_number   || '',
        engineModel:  order.engine               || '',
        engineSerial: order.engine_serial_number || '',
    };
    store.tvUnitInfoErrors.value = { unitSerial: false, engineModel: false, engineSerial: false };
    // Persist mode on first selection so future openings skip the choice screen
    if (!order.tv_job_mode) {
        dbTv.saveTvJobMode(order.id, 'unit').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

// ── openTvAssyStock ───────────────────────────────────────────
// Opens the TV Subassy workflow screen.
export function openTvAssyStock(order) {
    store.activeOrder.value        = order;
    store.tvAssyJobType.value      = 'stock';
    store.tvModeSelectOpen.value   = false;
    store.tvAssyStockOpen.value    = true;
    store.tvAssyOpEditing.value    = false;
    loadWoFiles(order.part_number);
    store.tvStockPending.value     = '';
    store.tvStockSessionQty.value  = '';
    store.tvStockReason.value      = '';
    store.tvStockQtyError.value    = false;
    store.tvStockReasonError.value = false;
    store.tvStockNotes.value       = order.tv_assy_notes || '';
    // Persist mode on first selection so future openings skip the choice screen
    if (!order.tv_job_mode) {
        dbTv.saveTvJobMode(order.id, 'stock').then(res => {
            if (!res.error && res.data?.[0]) {
                const updated = res.data[0];
                store.activeOrder.value = updated;
                store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
            }
        });
    }
}

// ── submitTvUnitStageFromUi ───────────────────────────────────
// Validates and submits a TV Unit stage action.
// Input: stageName = 'engine' | 'cart' | 'final'
export async function submitTvUnitStageFromUi(stageName) {
    const stageRef   = stageName === 'engine' ? store.tvEngStage : stageName === 'cart' ? store.tvCrtStage : store.tvFinStage;
    const stageKey   = 'tv_' + stageName;
    const prefix     = stageName === 'engine' ? 'TVENG' : stageName === 'cart' ? 'TVCRT' : 'TVFIN';
    const order      = store.activeOrder.value;
    const pending    = stageRef.value.pending;
    const operator   = store.tvAssyEntryName.value;
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
        const result = await dbTv.submitTvUnitStageAction({
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
            description: `TV ${stageName} ${STATUS_MAP[pending] || "can't start"} — WO ${order.wo_number}`,
            dept: store.selectedDept.value
        };
        if (updated.status === 'completed') await db.autoReceiveAssyWo(updated, operator);
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('submitTvUnitStageFromUi', err, { id: store.activeOrder.value?.id, stageName });
    } finally {
        store.loading.value = false;
    }
}

// ── submitTvStockActionFromUi ─────────────────────────────────
// Validates and submits a TV Subassy action.
export async function submitTvStockActionFromUi() {
    const order      = store.activeOrder.value;
    const pending    = store.tvStockPending.value;
    const operator   = store.tvAssyEntryName.value;
    const sessionQty = store.tvStockSessionQty.value;
    const reason     = store.tvStockReason.value.trim();

    store.tvStockQtyError.value    = false;
    store.tvStockReasonError.value = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        store.tvStockQtyError.value = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        store.tvStockReasonError.value = true; hasError = true;
    }
    if (hasError) return;

    const STATUS_MAP = { start: 'started', pause: 'paused', resume: 'started', complete: 'completed', hold: 'on_hold', cant_start: null };
    const keepStatus = pending === 'cant_start';

    const previousSnapshot = deepClone(order);
    store.loading.value = true;
    try {
        const result = await dbTv.submitTvStockAction({
            id:           order.id,
            currentOrder: order,
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
        store.tvStockPending.value    = '';
        store.tvStockSessionQty.value = '';
        store.tvStockReason.value     = '';
        store.showToast('Action recorded', 'success');
        store.lastUndoAction.value = {
            id: order.id, previousData: previousSnapshot,
            description: `TV stock ${pending} — WO ${order.wo_number}`,
            dept: store.selectedDept.value
        };
        if (updated.status === 'completed') await db.autoReceiveAssyWo(updated, operator);
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('submitTvStockActionFromUi', err, { id: store.activeOrder.value?.id, pending });
    } finally {
        store.loading.value = false;
    }
}

// tvStockDirectAction — submits a TV Subassy action immediately without a confirm step.
// Used for start and resume which need no qty or reason input.
export async function tvStockDirectAction(action) {
    store.tvStockPending.value = action;
    await submitTvStockActionFromUi();
}

// saveTvStockNotes — saves TV Subassy notes/mods text to the database.
export async function saveTvStockNotes() {
    const order = store.activeOrder.value;
    if (!order?.id) return;
    store.loading.value = true;
    try {
        const result = await dbTv.saveTvAssyNotes(order.id, store.tvStockNotes.value);
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('Notes saved', 'success');
    } catch (err) {
        store.showToast('Failed to save notes: ' + err.message);
        logError('saveTvStockNotes', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// tvUnitStageDirectAction — submits a TV Unit stage action immediately (no confirm step).
// Input: stageName = 'engine'|'cart', action = 'start'|'resume'
export async function tvUnitStageDirectAction(stageName, action) {
    const stageRef = stageName === 'engine' ? store.tvEngStage : store.tvCrtStage;
    stageRef.value.pending = action;
    await submitTvUnitStageFromUi(stageName);
}

// saveTvUnitDetails — saves the inline unit detail fields to work_orders (fire on blur).
export async function saveTvUnitDetails() {
    const order = store.activeOrder.value;
    if (!order) return;
    store.loading.value = true;
    try {
        const f = store.tvUnitInfoForm.value;
        const result = await dbTv.saveTvUnitInfo(order.id, f.unitSerial, f.engineModel, f.engineSerial);
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('Details saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save details: ' + err.message);
        logError('saveTvUnitDetails', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// markTvUnitWoComplete — validates unit detail fields then marks the WO complete.
export async function markTvUnitWoComplete() {
    const operator = store.tvAssyEntryName.value.trim();
    if (!operator) { store.showToast('Enter your name before completing the WO.', 'error'); return; }
    const form   = store.tvUnitInfoForm.value;
    const errors = store.tvUnitInfoErrors.value;
    errors.unitSerial   = !form.unitSerial.trim();
    errors.engineModel  = !form.engineModel.trim();
    errors.engineSerial = !form.engineSerial.trim();
    if (errors.unitSerial || errors.engineModel || errors.engineSerial) {
        store.showToast('Unit Serial #, Engine Model, and Engine Serial # are required.', 'error');
        return;
    }
    const order = store.activeOrder.value;
    const previousSnapshot = deepClone(order);
    store.loading.value = true;
    try {
        const result = await dbTv.completeTvUnitWo({ id: order.id, currentOrder: order, opName: operator });
        if (result.error) throw result.error;
        const updated = result.data[0];
        store.activeOrder.value = updated;
        store.orders.value = store.orders.value.map(o => o.id === updated.id ? updated : o);
        store.showToast('WO marked complete', 'success');
        store.lastUndoAction.value = {
            id: order.id, previousData: previousSnapshot,
            description: `TV Unit WO complete — ${order.wo_number}`,
            dept: store.selectedDept.value
        };
        recordUnitCompletion(updated.id, updated.wo_number, 'Trac Vac Assy', 1, {
            unitSerial:   form.unitSerial,
            engineModel:  form.engineModel,
            engineSerial: form.engineSerial,
            operator,
        }, updated.job_number || null);
        await db.autoReceiveAssyWo(updated, operator);
    } catch (err) {
        store.showToast('Failed: ' + err.message);
        logError('markTvUnitWoComplete', err, { id: store.activeOrder.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// tvUnitOpenHold — opens the sidebar hold form for the currently active unit stage.
export function tvUnitOpenHold() {
    store.tvUnitHoldOpen.value        = true;
    store.tvUnitHoldReason.value      = '';
    store.tvUnitHoldReasonError.value = false;
}

// tvUnitConfirmHold — validates reason and submits hold for the active engine or cart stage.
export async function tvUnitConfirmHold() {
    if (!store.tvUnitHoldReason.value.trim()) {
        store.tvUnitHoldReasonError.value = true;
        return;
    }
    const order = store.activeOrder.value;
    const stageName = order.tv_cart_status   === 'started' ? 'cart'
                    : order.tv_engine_status === 'started' ? 'engine'
                    : null;
    if (!stageName) { store.tvUnitHoldOpen.value = false; return; }
    const stageRef = stageName === 'engine' ? store.tvEngStage : store.tvCrtStage;
    stageRef.value.pending = 'hold';
    stageRef.value.reason  = store.tvUnitHoldReason.value;
    store.tvUnitHoldOpen.value = false;
    await submitTvUnitStageFromUi(stageName);
}
