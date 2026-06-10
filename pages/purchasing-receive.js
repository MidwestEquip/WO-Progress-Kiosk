// ============================================================
// pages/purchasing-receive.js — Purchasing order completion + receiving
//
// completeOrder: validate required fields and mark order received.
// submitReceiving: record partial/full qty received from PO Receive flow.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

export function _replaceInStore(updated) {
    store.purchasingOrders.value = store.purchasingOrders.value.map(o =>
        o.id === updated.id ? updated : o
    );
}

// completeOrder — validate required ordering fields then mark order received/completed.
export async function completeOrder() {
    const order = store.purchasingDetailOrder.value;
    const form  = store.purchasingDetailForm.value;

    if (!form.supplier_name?.trim()) {
        store.showToast('Supplier Name is required to complete.', 'error'); return;
    }
    if (!form.po_number?.trim()) {
        store.showToast('PO # is required to complete.', 'error'); return;
    }
    if (!form.qty_ordered || parseFloat(form.qty_ordered) <= 0) {
        store.showToast('Qty Ordered is required to complete.', 'error'); return;
    }
    // expected_date may be auto-calculated from lead time — replicate that logic here
    let expectedDate = form.expected_date || null;
    if (!expectedDate && form.estimated_lead_time && order.date_requested) {
        const d = new Date(order.date_requested);
        d.setDate(d.getDate() + parseFloat(form.estimated_lead_time));
        expectedDate = d.toISOString().split('T')[0];
    }
    if (!expectedDate) {
        store.showToast('Expected Date is required to complete.', 'error'); return;
    }
    if (!form.cost || parseFloat(form.cost) <= 0) {
        store.showToast('Cost is required to complete.', 'error'); return;
    }

    const now = new Date().toISOString();
    const updates = {
        status:               'ordered',
        supplier_name:        form.supplier_name.trim(),
        supplier_part_number: form.supplier_part_number?.trim() || null,
        po_number:            form.po_number.trim(),
        date_ordered:         form.date_ordered                 || null,
        qty_ordered:          parseFloat(form.qty_ordered),
        cost:                 parseFloat(form.cost),
        estimated_lead_time:  parseFloat(form.estimated_lead_time) || null,
        expected_date:        expectedDate,
        purchaser_notes:      form.purchaser_notes?.trim()      || null,
        purchaser_questions:  form.purchaser_questions?.trim()  || null,
        production_notes:     form.production_notes?.trim()     || null,
        last_status_update:   now,
    };

    store.purchasingDetailSaving.value = true;
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, updates);
        if (error) throw error;

        store.purchasingOrders.value     = store.purchasingOrders.value.filter(o => o.id !== order.id);
        store.poReceiveOrders.value      = store.poReceiveOrders.value.filter(o => o.id !== order.id);
        store.purchasingCompletedOrders.value = [data, ...store.purchasingCompletedOrders.value];
        store.purchasingDetailOpen.value = false;
        store.showToast('Order placed — visible in Completed tab.', 'success');

        db.insertPurchasingEvent({
            orderId:   order.id,
            eventType: 'status_change',
            note:      'Order placed',
            oldStatus: order.status,
            newStatus: 'ordered',
            createdBy: 'purchasing',
        });
    } catch (err) {
        store.showToast('Failed to complete order: ' + err.message);
        logError('completeOrder', err);
    } finally {
        store.purchasingDetailSaving.value = false;
    }
}

// submitReceiving — record quantity received; auto-sets status.
export async function submitReceiving() {
    const order       = store.purchasingDetailOrder.value;
    const form        = store.purchasingReceiveForm.value;
    const qtyReceived = parseFloat(form.qty_received) || 0;
    const qtyFull     = parseFloat(order.qty_ordered) || parseFloat(order.qty_needed) || qtyReceived;

    if (qtyReceived <= 0) {
        store.showToast('Enter a quantity received greater than 0.', 'error'); return;
    }
    if (!form.received_by?.trim()) {
        store.showToast('Enter the name of who received the order.', 'error'); return;
    }

    const newStatus = qtyReceived >= qtyFull ? 'received' : 'partially_received';
    const now       = new Date().toISOString();
    const updates   = {
        qty_received:       qtyReceived,
        received_by:        form.received_by.trim(),
        received_at:        now,
        status:             newStatus,
        last_status_update: now,
    };
    if (newStatus === 'received') updates.completed_at = now;

    store.purchasingReceiveSaving.value = true;
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, updates);
        if (error) throw error;

        if (newStatus === 'received') {
            store.purchasingOrders.value = store.purchasingOrders.value.filter(o => o.id !== order.id);
        } else {
            _replaceInStore(data);
        }

        store.purchasingDetailOpen.value = false;
        store.showToast(
            newStatus === 'received' ? 'Order fully received — moved to Completed.' : 'Partial receipt saved.',
            'success'
        );

        db.insertPurchasingEvent({
            orderId:   order.id,
            eventType: 'receiving',
            note:      `Received ${qtyReceived} by ${form.received_by.trim()}`,
            oldStatus: order.status,
            newStatus,
            createdBy: form.received_by.trim(),
        });
    } catch (err) {
        store.showToast('Failed to record receiving: ' + err.message);
        logError('submitReceiving', err);
    } finally {
        store.purchasingReceiveSaving.value = false;
    }
}
