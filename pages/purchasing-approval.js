// ============================================================
// pages/purchasing-approval.js — Manager approval queue logic
//
// enterApprovalTab: verify manager PIN and unlock approval view.
// approveOrder: set status approved, log event.
// submitRevise: set status not_approved, append manager note.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { getPin } from '../libs/pins.js';
import { logError } from '../libs/db-shared.js';

function _replaceInStore(updated) {
    store.purchasingOrders.value = store.purchasingOrders.value.map(o =>
        o.id === updated.id ? updated : o
    );
}

// enterApprovalTab — verify manager PIN; unlock approval view on success.
export function enterApprovalTab() {
    const pin     = store.approvalPinInput.value?.trim();
    const correct = getPin('manager');
    if (!correct || pin !== correct) {
        store.approvalPinError.value = true;
        return;
    }
    store.approvalPinError.value      = false;
    store.approvalManagerAuthed.value = true;
}

// approveOrder — mark order approved, close detail modal, log event.
export async function approveOrder(order) {
    if (!order) return;
    const now = new Date().toISOString();
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, {
            status: 'approved', last_status_update: now,
        });
        if (error) throw error;
        _replaceInStore(data);
        store.purchasingDetailOpen.value = false;
        store.showToast('Order approved.', 'success');
        db.insertPurchasingEvent({
            orderId:   order.id,
            eventType: 'status_change',
            note:      'Approved by manager',
            oldStatus: 'quoted',
            newStatus: 'approved',
            createdBy: 'manager',
        });
    } catch (err) {
        store.showToast('Failed to approve order: ' + err.message);
        logError('approveOrder', err);
    }
}

// cancelRevise — close the revise panel without saving.
export function cancelRevise() {
    store.approvalReviseOpen.value = false;
    store.approvalReviseNote.value = '';
}

// submitRevise — set status not_approved, prepend manager note to purchaser_notes.
export async function submitRevise(order) {
    if (!order) return;
    const note = store.approvalReviseNote.value?.trim();
    if (!note) {
        store.showToast('Enter a revision note before submitting.', 'error'); return;
    }
    const existing = order.purchaser_notes?.trim() || '';
    const newNotes = existing
        ? `[Response to Approval request]: ${note}\n\n${existing}`
        : `[Response to Approval request]: ${note}`;
    const now = new Date().toISOString();
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, {
            status:           'not_approved',
            purchaser_notes:  newNotes,
            last_status_update: now,
        });
        if (error) throw error;
        _replaceInStore(data);
        store.purchasingDetailOpen.value = false;
        store.approvalReviseOpen.value   = false;
        store.approvalReviseNote.value   = '';
        store.showToast('Order returned for revision.', 'success');
        db.insertPurchasingEvent({
            orderId:   order.id,
            eventType: 'status_change',
            note:      `Revision requested: ${note}`,
            oldStatus: 'quoted',
            newStatus: 'not_approved',
            createdBy: 'manager',
        });
    } catch (err) {
        store.showToast('Failed to submit revision: ' + err.message);
        logError('submitRevise', err);
    }
}
