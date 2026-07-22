// ============================================================
// pages/wo-status-view.js — Office receiving & close-out logic
//
// Handles: search for WOs, receive modal, close-out modal,
//          refresh of tracking data
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { isNonEmpty, sanitizeText, buildWoCloseoutTxns } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// ── searchOfficeReceive ───────────────────────────────────────
export async function loadReceivingEligible() {
    store.loading.value = true;
    try {
        const { data, error } = await db.fetchReceivingEligible();
        if (error) throw error;
        store.receiveEligibleList.value = data || [];
    } catch (err) {
        store.showToast('Failed to load receiving list: ' + err.message);
        logError('loadReceivingEligible', err);
    } finally {
        store.loading.value = false;
    }
}

export function searchOfficeReceive() {
    store.officeSuccessMsg.value = '';
    const term = store.officeSearchTerm.value.trim().toLowerCase();
    if (!term) {
        store.officeSearchResults.value = [];
        return;
    }
    store.officeSearchResults.value = store.receiveEligibleList.value.filter(o =>
        (o.wo_number   || '').toLowerCase().includes(term) ||
        (o.sales_order || '').toLowerCase().includes(term) ||
        (o.part_number || '').toLowerCase().includes(term)
    );
}

// ── openReceiveModal ──────────────────────────────────────────
export function switchToCloseout() {
    store.officeSearchTerm.value    = '';
    store.officeSearchResults.value = [];
    store.officeSuccessMsg.value    = '';
    if (store.closeoutAuthorized.value) {
        store.officeMode.value = 'closeout';
    } else {
        store.pinInput.value     = '';
        store.pinMode.value      = 'closeout_office';
        store.pinModalOpen.value = true;
    }
}

export function openReceiveModal(order) {
    store.receiveTarget.value        = order;
    store.receiverName.value         = '';
    store.receiverQty.value          = null;
    store.receiverBinLocation.value  = '';
    store.receiverNameError.value    = false;
    // Reset the "sales orders using this part" panel, then load it non-blocking so
    // the modal opens instantly (the list is informational + a soft ack, never a hard gate).
    store.receiveMatchedSos.value    = [];
    store.receiveSoAck.value         = false;
    store.receiveModalOpen.value     = true;
    loadReceiveMatchedSos(order);
}

// loadReceiveMatchedSos — fetch open_orders rows the received part feeds (direct
// part match or a waiting_on subpart match) into store.receiveMatchedSos. Non-fatal:
// a failure just leaves the panel empty (toast + log), the receive still works.
export async function loadReceiveMatchedSos(order) {
    store.receiveMatchedLoading.value = true;
    try {
        const { data, error } = await db.findOpenOrdersForPart(order?.part_number);
        if (error) throw error;
        // Guard against a stale response after the user closed / switched the modal.
        if (store.receiveTarget.value?.id !== order?.id) return;
        store.receiveMatchedSos.value = data || [];
    } catch (err) {
        store.showToast('Could not load sales orders for this part: ' + err.message);
        logError('loadReceiveMatchedSos', err, { part: order?.part_number });
    } finally {
        store.receiveMatchedLoading.value = false;
    }
}

// _receivePart — the normalized part # currently being received (the WO's part).
function _receivePart() {
    return (store.receiveTarget.value?.part_number || '').trim().toUpperCase();
}

// receiveMatchIsSubpart — true when a matched SO row ships a DIFFERENT part and only
// lists the received part in its waiting_on list. In that case "In Stock" must target
// the waiting_on entry (the subpart is now on the shelf), NOT the whole SO row's status.
export function receiveMatchIsSubpart(so) {
    const part = _receivePart();
    const rowPart = (so?.part_number || '').trim().toUpperCase();
    if (!part || rowPart === part) return false;
    return Array.isArray(so?.waiting_on)
        && so.waiting_on.some(e => (e?.part_number || '').trim().toUpperCase() === part);
}

// receiveMatchInStock — whether this match already reads "in stock" for the received
// part: direct match → the SO row status is 'In Stock'; subpart match → the waiting_on
// entry for the received part carries an in_stock flag. Drives the panel's button/label.
export function receiveMatchInStock(so) {
    const part = _receivePart();
    if (receiveMatchIsSubpart(so)) {
        return (so.waiting_on || []).some(e =>
            (e?.part_number || '').trim().toUpperCase() === part && e?.in_stock);
    }
    return so?.status === 'In Stock';
}

// markMatchedSoInStock — mark the received part as on the shelf for one matched SO.
// Direct match → set the SO row status to 'In Stock'. Subpart match → flag the row's
// waiting_on entry for the received part in_stock (leaving the SO's own status alone).
// Updates the panel row and the live Open Orders board in place.
export async function markMatchedSoInStock(so) {
    if (!so?.id) return;
    const part = _receivePart();
    try {
        const now = new Date().toISOString();
        let patch;
        if (receiveMatchIsSubpart(so)) {
            const waiting_on = (so.waiting_on || []).map(e =>
                (e?.part_number || '').trim().toUpperCase() === part ? { ...e, in_stock: true } : e);
            patch = { waiting_on };
        } else {
            patch = { status: 'In Stock', last_status_update: now };
        }
        const { error } = await db.updateOpenOrder(so.id, patch);
        if (error) throw error;
        store.receiveMatchedSos.value = store.receiveMatchedSos.value.map(o =>
            o.id === so.id ? { ...o, ...patch } : o);
        store.openOrders.value = store.openOrders.value.map(o =>
            o.id === so.id ? { ...o, ...patch } : o);
        store.showToast('Marked In Stock ✓', 'success');
    } catch (err) {
        store.showToast('Failed to mark In Stock: ' + err.message);
        logError('markMatchedSoInStock', err, { id: so.id });
    }
}

// goToOpenOrdersForReceive — jump from the Receiving modal to the Open Orders board,
// pre-filtered to this WO's part. The extended openOrderMatchesFilter also matches
// rows waiting on the part as a subpart, so both scenarios surface. main.js's
// currentView watch fires loadOpenOrders() for the fresh board.
export function goToOpenOrdersForReceive(order) {
    store.openOrdersFilter.value = (order?.part_number || '').trim();
    store.shippingTab.value      = 'orders';
    store.receiveModalOpen.value = false;
    store.currentView.value      = 'open_orders';
}

// _syncOpenOrdersForWoReceive — flip matching Open Orders rows to
// 'WO/PO Complete' when a finished WO is received into stock, so shipping
// knows the parts are on the shelf. Matches by WO/PO # or SO# + part #;
// only WO-path rows flip (Boxed/Picked/New etc. untouched). Non-fatal:
// the receive has already succeeded, so toast + log only.
// order: the work_orders row being received. No return value.
async function _syncOpenOrdersForWoReceive(order) {
    try {
        const { data, error } = await db.findOpenOrdersForWo(
            order.wo_number, order.sales_order, order.part_number);
        if (error) throw error;
        const rows = (data || []).filter(o =>
            ['WO Requested', 'WO Created', 'In Progress'].includes(o.status));
        if (!rows.length) return;
        const now = new Date().toISOString();
        const results = await Promise.all(rows.map(o =>
            db.updateOpenOrder(o.id, { status: 'WO/PO Complete', last_status_update: now })));
        const failed = results.filter(r => r.error);
        if (failed.length) throw new Error(`${failed.length} row(s) failed to update`);
    } catch (err) {
        store.showToast('Received, but the Open Orders board did not sync: ' + err.message);
        logError('_syncOpenOrdersForWoReceive', err, { wo_number: order?.wo_number });
    }
}

// ── submitReceive ─────────────────────────────────────────────
export async function submitReceive() {
    store.receiverNameError.value = !isNonEmpty(store.receiverName.value);
    if (store.receiverNameError.value) return;

    store.loading.value = true;
    try {
        const order = store.receiveTarget.value;
        // Blank receiver qty (null / '') falls back to the actual completed qty,
        // else 0 — never the full WO qty. An entered or completed 0 is preserved.
        const rq    = store.receiverQty.value;
        const qty   = (rq === null || rq === undefined || rq === '')
                        ? (order.qty_completed ?? 0)
                        : rq;

        const { error } = await db.receiveWorkOrder(
            order,
            qty,
            sanitizeText(store.receiverName.value),
            store.receiverBinLocation.value
        );
        if (error) throw error;

        // Success: show confirmation, clear search, refresh list
        const woNum   = order.wo_number;
        const recName = sanitizeText(store.receiverName.value);
        store.receiveModalOpen.value     = false;
        store.officeSuccessMsg.value     = `WO #${woNum} received by ${recName} \u2713`;
        store.officeSearchTerm.value     = '';
        store.officeSearchResults.value  = [];

        // Open Orders board: finished goods in stock — hand rows back to shipping.
        await _syncOpenOrdersForWoReceive(order);

        await _refreshWoStatusData();
        await loadReceivingEligible();

        // Auto-clear success message after 5 seconds
        setTimeout(() => { store.officeSuccessMsg.value = ''; }, 5000);
    } catch (err) {
        store.showToast('Failed to receive: ' + err.message);
        logError('submitReceive', err, { id: store.receiveTarget.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── openCloseoutModal ─────────────────────────────────────────
export function openCloseoutModal(order) {
    store.closeoutTarget.value     = order;
    store.closeoutName.value       = '';
    store.closeoutNameError.value  = false;
    store.closeoutModalOpen.value  = true;
}

// ── submitCloseout ────────────────────────────────────────────
export async function submitCloseout() {
    store.closeoutNameError.value = !isNonEmpty(store.closeoutName.value);
    if (store.closeoutNameError.value) return;

    store.loading.value = true;
    try {
        const { error } = await db.closeOutWorkOrder(
            store.closeoutTarget.value.id,
            sanitizeText(store.closeoutName.value)
        );
        if (error) throw error;

        store.closeoutModalOpen.value = false;
        store.showToast('Work order closed out successfully.', 'success');
        _recordCloseoutTxns(store.closeoutTarget.value); // non-fatal, not awaited
        await _refreshWoStatusData();
    } catch (err) {
        store.showToast('Failed to close out: ' + err.message);
        logError('submitCloseout', err, { id: store.closeoutTarget.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── Native inventory ledger: closeout emission ────────────────
// Fired (not awaited) after a successful closeout: one MO/I row puts the
// finished part into stock, one MO/O row per direct BOM child backflushes
// components (single-level — subassy WOs backflush their own children at
// their own closeout). Qty rule: office-verified qty_received, else the
// joined qty_completed fallback; missing/zero → skip with a warning.
// Never re-queries work_orders — archiveWorkOrder deletes them async.
// The ledger anchors on CLOSEOUT deliberately: closeout has no undo path,
// so no compensating rows are ever needed. Do not move this to WO
// completion, which is undoable.
async function _recordCloseoutTxns(row) {
    try {
        const qty = Number(row?.qty_received ?? row?.qty_completed_fallback ?? 0);
        if (!row?.part_number?.trim() || !(qty > 0)) {
            store.showToast('Closed out, but no valid quantity found — inventory ledger not updated.');
            return;
        }
        const { data: children, error: bomErr } = await db.fetchBomChildrenForParent(row.part_number);
        if (bomErr) throw bomErr;
        const txns = buildWoCloseoutTxns(row, qty, children);
        if (!txns.length) return;
        const { error } = await db.insertInventoryTxns(txns);
        if (error) throw error;
    } catch (err) {
        store.showToast('Closed out, but inventory ledger did not record: ' + err.message);
        logError('_recordCloseoutTxns', err, { id: row?.id, wo: row?.wo_number });
    }
}

// ── Alere bin update resolution ───────────────────────────────

// Opens the inline confirm form for a specific tracking row.
export function openAlereConfirm(row) {
    store.alereConfirmId.value        = row.id;
    store.alereUpdaterName.value      = '';
    store.alereUpdaterNameError.value = false;
}

// Cancels without saving.
export function cancelAlereConfirm() {
    store.alereConfirmId.value        = null;
    store.alereUpdaterName.value      = '';
    store.alereUpdaterNameError.value = false;
}

// Submits the Alere-updated confirmation for the active row.
export async function submitAlereUpdated() {
    store.alereUpdaterNameError.value = !isNonEmpty(store.alereUpdaterName.value);
    if (store.alereUpdaterNameError.value) return;

    store.loading.value = true;
    try {
        const { error } = await db.markAlereUpdated(
            store.alereConfirmId.value,
            sanitizeText(store.alereUpdaterName.value)
        );
        if (error) throw error;

        store.alereConfirmId.value = null;
        store.alereUpdaterName.value = '';
        store.showToast('Alere bin location marked as updated.', 'success');
        await _refreshWoStatusData();
    } catch (err) {
        store.showToast('Failed to mark Alere updated: ' + err.message);
        logError('submitAlereUpdated', err, { id: store.alereConfirmId.value });
    } finally {
        store.loading.value = false;
    }
}

// ── saveCloseoutNoteInline ────────────────────────────────────
// Fire-and-forget inline save for the notes field on a closeout row.
export async function saveCloseoutNoteInline(id, notes) {
    try {
        const { error } = await db.saveCloseoutNotes(id, notes);
        if (error) throw error;
    } catch (err) {
        store.showToast('Failed to save notes: ' + err.message);
        logError('saveCloseoutNoteInline', err);
    }
}

// ── loadClosedOutOrders ───────────────────────────────────────
// Fetches closed WOs within the selected date range into store.
export async function loadClosedOutOrders() {
    store.loading.value = true;
    try {
        const { data, error } = await db.fetchClosedOutOrders(
            store.closedOutFrom.value,
            store.closedOutTo.value
        );
        if (error) throw error;
        store.closedOutOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load closed out WOs: ' + err.message);
        logError('loadClosedOutOrders', err);
    } finally {
        store.loading.value = false;
    }
}

// ── openClosedOutHistory ──────────────────────────────────────
// Switches to history mode, defaults date range to last 30 days, loads data.
export async function openClosedOutHistory() {
    store.closedOutFilter.value = '';
    const to   = new Date();
    const from = new Date(); from.setDate(from.getDate() - 30);
    store.closedOutTo.value   = to.toISOString().slice(0, 10);
    store.closedOutFrom.value = from.toISOString().slice(0, 10);
    store.officeMode.value    = 'history';
    await loadClosedOutOrders();
}

// ── Internal helpers ──────────────────────────────────────────

async function _refreshWoStatusData() {
    try {
        const { woStatus, closeout, error } = await db.fetchWoStatusOrders();
        if (error) throw error;
        store.woStatusOrders.value = woStatus;
        store.closeoutOrders.value = closeout;
    } catch (err) {
        store.showToast('Failed to refresh WO status data: ' + err.message);
        logError('_refreshWoStatusData', err);
    }
}

// ── goToCloseout ──────────────────────────────────────────────
// Switches the Office view to close-out mode.
// Requires PIN if closeoutAuthorized is not already set.
export function goToCloseout() {
    store.officeSearchTerm.value    = '';
    store.officeSearchResults.value = [];
    store.officeSuccessMsg.value    = '';
    if (store.closeoutAuthorized?.value) {
        store.officeMode.value = 'closeout';
    } else {
        store.pinInput.value     = '';
        store.pinMode.value      = 'closeout_office';
        store.pinModalOpen.value = true;
    }
}
