// ============================================================
// pages/dashboard-tv.js — TV (Trac Vac) Assy workflow logic
//
// Handles: mode selection, unit stages, stock workflow,
//          hold flows, notes, auto-receive on completion.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import * as dbTv  from '../libs/db-tv.js';
import { recordUnitCompletion, fetchDraftUnitCompletions, fetchUnitCompletionsByWorkOrderId, upsertUnitDraft, deleteUnitRowsAbove } from '../libs/db-assy.js';
import { deepClone } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// Monotonic client-side id for unit rows — used as the v-for :key so add/remove never aliases
// v-model state to the wrong card. Only needs uniqueness within the current list.
let _tvUnitUidSeq = 0;
const nextTvUnitUid = () => ++_tvUnitUidSeq;

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
// Legacy unit WOs (tv_job_mode='unit', stamped by the old unit workflow) keep the unit screen so
// their engine/cart progress stays visible. Everything else — new WOs (null mode) and stock WOs —
// opens the subassy screen, which now carries the optional Unit Details panel.
export function openTvAssyEntry(order) {
    store.activeOrder.value     = order;
    store.tvAssyEntryName.value = order.operator || '';
    if (order.tv_job_mode === 'unit') openTvAssyUnit(order);
    else                              openTvAssyStock(order);
}

// tvSelectMode — legacy mode-select handler (no longer reachable; removal deferred to cleanup patch).
// Input: mode = 'unit' | 'stock'
export function tvSelectMode(mode) {
    store.tvModeSelectOpen.value = false;
    const order = store.activeOrder.value;
    if (mode === 'unit') openTvAssyUnit(order);
    else                 openTvAssyStock(order);
}

// ── openTvAssyUnit ────────────────────────────────────────────
// Opens the TV Unit workflow screen; resets stage pending states and restores draft units.
export async function openTvAssyUnit(order) {
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
    // Default unit #1 from order fields while fetch is in-flight
    store.tvUnitDetailList.value = [{
        _uid:         nextTvUnitUid(),
        salesOrder:   order.sales_order || '',
        unitSerial:   order.unit_serial_number || '',
        engineModel:  order.engine || '',
        engineSerial: order.engine_serial_number || '',
        notes:        '',
    }];
    store.tvUnitNotes.value     = order.tv_assy_notes || '';
    store.tvUnitListError.value = false;
    // For completed WOs fetch all rows (incl. stamped); for active WOs fetch drafts only.
    const oid = order.id;
    const { data } = order.status === 'completed'
        ? await fetchUnitCompletionsByWorkOrderId(order.id)
        : await fetchDraftUnitCompletions(order.id);
    if (store.activeOrder.value?.id !== oid) return;  // a different WO was opened mid-fetch
    if (data && data.length > 0) {
        store.tvUnitDetailList.value = data.map(r => ({
            _uid:         nextTvUnitUid(),
            salesOrder:   r.unit_number === 1 ? (order.sales_order || '') : '',
            unitSerial:   r.unit_serial_number || '',
            engineModel:  r.engine_model || '',
            engineSerial: r.engine_serial_number || '',
            notes:        r.unit_notes || '',
        }));
    }
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
// Opens the TV Subassy workflow screen. Now also hosts the optional multi-unit Unit Details panel,
// so it seeds/loads tvUnitDetailList the same way the unit screen does.
export async function openTvAssyStock(order) {
    store.activeOrder.value        = order;
    store.tvAssyJobType.value      = 'stock';
    store.tvModeSelectOpen.value   = false;
    store.tvAssyStockOpen.value    = true;
    store.tvAssyOpEditing.value    = false;
    store.tvAssyNameError.value    = false;
    loadWoFiles(order.part_number);
    store.tvStockPending.value     = '';
    store.tvStockSessionQty.value  = '';
    store.tvStockReason.value      = '';
    store.tvStockQtyError.value    = false;
    store.tvStockReasonError.value = false;
    store.tvStockNotes.value       = order.tv_assy_notes || '';
    // Unit Details panel — optional. Default unit #1 from order fields while fetch is in-flight.
    store.tvUnitListError.value  = false;
    store.tvUnitNotes.value      = order.tv_assy_notes || '';
    store.tvUnitDetailList.value = [{
        _uid:         nextTvUnitUid(),
        salesOrder:   order.sales_order || '',
        unitSerial:   order.unit_serial_number || '',
        engineModel:  order.engine || '',
        engineSerial: order.engine_serial_number || '',
        notes:        '',
    }];
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
    // For completed WOs fetch stamped rows; for active WOs fetch drafts only.
    const oid = order.id;
    const { data } = order.status === 'completed'
        ? await fetchUnitCompletionsByWorkOrderId(order.id)
        : await fetchDraftUnitCompletions(order.id);
    if (store.activeOrder.value?.id !== oid) return;  // a different WO was opened mid-fetch
    if (data && data.length > 0) {
        store.tvUnitDetailList.value = data.map(r => ({
            _uid:         nextTvUnitUid(),
            salesOrder:   r.unit_number === 1 ? (order.sales_order || '') : '',
            unitSerial:   r.unit_serial_number || '',
            engineModel:  r.engine_model || '',
            engineSerial: r.engine_serial_number || '',
            notes:        r.unit_notes || '',
        }));
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
    store.tvAssyNameError.value    = false;
    let hasError = false;
    if ((pending === 'pause' || pending === 'complete') && String(sessionQty).trim() === '') {
        store.tvStockQtyError.value = true; hasError = true;
    }
    if ((pending === 'cant_start' || pending === 'hold') && !reason) {
        store.tvStockReasonError.value = true; hasError = true;
    }
    if (pending === 'complete' && !operator.trim()) {
        store.tvAssyNameError.value = true;
        store.showToast('Enter your name before completing the WO.', 'error');
        hasError = true;
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
        if (updated.status === 'completed') {
            // Stamp unit details only on the write that transitions to completed (not a re-complete).
            if (order.status !== 'completed') await stampTvUnits(updated, operator);
            await db.autoReceiveAssyWo(updated, operator);
        }
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
    if (store.actionPanelReadOnly.value) return;
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

// addTvUnit / removeTvUnit — expand or shrink the inline unit list.
export function addTvUnit() {
    if (store.actionPanelReadOnly.value) return;
    store.tvUnitDetailList.value = [
        ...store.tvUnitDetailList.value,
        { _uid: nextTvUnitUid(), salesOrder: '', unitSerial: '', engineModel: '', engineSerial: '', notes: '' }
    ];
}
export function removeTvUnit(idx) {
    if (store.actionPanelReadOnly.value) return;
    if (store.tvUnitDetailList.value.length <= 1) return;
    store.tvUnitDetailList.value = store.tvUnitDetailList.value.filter((_, i) => i !== idx);
    // Persist immediately so the now-orphaned highest-index draft row is cleaned up.
    saveTvUnitDetails();
}

// saveTvUnitDetails — upserts each unit as a draft row (keyed on work_order_id) on blur; toasts on failure.
// Also clears orphan draft rows whose unit_number exceeds the current list length (e.g. after a remove).
export async function saveTvUnitDetails() {
    if (store.actionPanelReadOnly.value) return;
    const order    = store.activeOrder.value;
    if (!order) return;
    const operator = store.tvAssyEntryName.value.trim();
    const list     = store.tvUnitDetailList.value;
    try {
        const results = await Promise.all(
            list.map((u, idx) =>
                upsertUnitDraft(order.id, order.wo_number, 'Trac Vac Assy', idx + 1, { ...u, operator }, order.job_number || null)
            )
        );
        await deleteUnitRowsAbove(order.id, list.length, 'unit_draft');
        const failed = results.find(r => r?.error);
        if (failed) {
            store.showToast("Couldn't save unit details — check your connection and try again.", 'error');
            logError('saveTvUnitDetails', failed.error, { id: order.id });
        }
    } catch (err) {
        store.showToast("Couldn't save unit details — check your connection and try again.", 'error');
        logError('saveTvUnitDetails', err, { id: order.id });
    }
}

// stampTvUnits — promotes the current non-blank unit rows to unit_completed records, then clears
// leftover draft rows and any orphan completed rows above the current unit count. Awaited + toasts on
// failure. Shared by the unit-screen completion and the subassy completion path. Skips blank rows by
// index (unit_number = idx+1 stays aligned with the drafts written by saveTvUnitDetails).
async function stampTvUnits(updatedOrder, operator) {
    const list = store.tvUnitDetailList.value;
    const promises = [];
    list.forEach((u, idx) => {
        const blank = !(u.salesOrder || '').trim() && !(u.unitSerial || '').trim()
                   && !(u.engineModel || '').trim() && !(u.engineSerial || '').trim()
                   && !(u.notes || '').trim();
        if (blank) return;  // skip; preserve idx so unit_number matches the saved draft
        promises.push(recordUnitCompletion(updatedOrder.id, updatedOrder.wo_number, 'Trac Vac Assy', idx + 1, {
            unitSerial:   u.unitSerial,
            engineModel:  u.engineModel,
            engineSerial: u.engineSerial,
            notes:        u.notes,
            operator,
        }, updatedOrder.job_number || null));
    });
    try {
        const results = await Promise.all(promises);
        await deleteUnitRowsAbove(updatedOrder.id, 0, 'unit_draft');               // wipe leftover/blank drafts
        await deleteUnitRowsAbove(updatedOrder.id, list.length, 'unit_completed'); // wipe orphan completed rows
        if (results.some(r => r?.error)) {
            store.showToast('Some unit records did not save — please re-check the unit details.', 'error');
            logError('stampTvUnits', results.find(r => r?.error).error, { id: updatedOrder.id });
        }
    } catch (err) {
        store.showToast('Some unit records did not save — please re-check the unit details.', 'error');
        logError('stampTvUnits', err, { id: updatedOrder.id });
    }
}

// markTvUnitWoComplete — validates all units then marks the WO complete.
export async function markTvUnitWoComplete() {
    const operator = store.tvAssyEntryName.value.trim();
    if (!operator) { store.showToast('Enter your name before completing the WO.', 'error'); return; }
    const incomplete = store.tvUnitDetailList.value.some(u =>
        !u.unitSerial.trim() || !u.engineModel.trim() || !u.engineSerial.trim()
    );
    if (incomplete) {
        store.tvUnitListError.value = true;
        store.showToast('Unit Serial #, Engine, and Engine Serial # are required for all units.', 'error');
        return;
    }
    store.tvUnitListError.value = false;
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
        await stampTvUnits(updated, operator);
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
