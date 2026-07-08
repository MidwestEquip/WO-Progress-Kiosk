// ============================================================
// pages/purchasing-receive.js — Purchasing order completion + receiving
//
// completeOrder: validate required fields and mark order received.
// submitReceiving: record partial/full qty received from PO Receive flow.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { PURCHASING_ACTIVE_STATUSES } from '../libs/config.js';

export function _replaceInStore(updated) {
    store.purchasingOrders.value = store.purchasingOrders.value.map(o =>
        o.id === updated.id ? updated : o
    );
}

// _padSteelQuotes — mirror of normalizeSteelQuotes (purchasing-view.js) for a
// single realtime row so a spliced-in steel order matches the padded shape the
// initial list load produces. Kept local to avoid a cross-page circular import.
function _padSteelQuotes(o) {
    if (o.request_type !== 'steel') return;
    const q = Array.isArray(o.steel_quotes) ? o.steel_quotes : [];
    while (q.length < 5) q.push({ supplier: '', price: '', lead_time: '', best: false, notes: '', file_path: '', file_name: '' });
    q.forEach(slot => {
        if (slot.notes     === undefined) slot.notes     = '';
        if (slot.file_path === undefined) slot.file_path = '';
        if (slot.file_name === undefined) slot.file_name = '';
        slot._uploading = false;
    });
    o.steel_quotes = q;
}

// _rowsEqualIgnoringVolatile — cheap self-echo check. Ignores the server-stamped
// updated_at so our own writes (already applied locally) don't force a re-render.
function _rowsEqualIgnoringVolatile(a, b) {
    if (!a || !b) return false;
    const strip = ({ updated_at, ...rest }) => rest;
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// reconcilePurchasingRealtime — surgical in-place merge of a realtime
// purchasing_orders change into store.purchasingOrders, replacing the old
// full-list reload that reset scroll/focus on every edit. Honors the same
// active-status + forecasted filter as fetchPurchasingOrders, so rows that leave
// the active set are dropped and re-entrants are added.
// Input: realtime payload { eventType, new: row, old }. No return value.
export function reconcilePurchasingRealtime({ eventType, new: row, old }) {
    const list = store.purchasingOrders.value;
    if (eventType === 'DELETE') {
        const id = old?.id;
        if (id != null) store.purchasingOrders.value = list.filter(o => o.id !== id);
        return;
    }
    if (!row) return;
    const idx     = list.findIndex(o => o.id === row.id);
    const belongs = row.forecasted === false && PURCHASING_ACTIVE_STATUSES.includes(row.status);
    if (!belongs) {
        if (idx !== -1) store.purchasingOrders.value = list.filter(o => o.id !== row.id);
        return;
    }
    _padSteelQuotes(row);
    if (idx === -1) {
        store.purchasingOrders.value = [row, ...list]; // newest first, matches created_at desc
        return;
    }
    if (_rowsEqualIgnoringVolatile(list[idx], row)) return; // self-echo, no-op
    const next = [...list];
    next[idx]  = row;
    store.purchasingOrders.value = next;
}

// _syncOpenOrderForPo — mirror a purchasing status change onto the matching
// open_orders row (part orders with a SO# only; matched by SO# + part #).
// patch: open_orders fields to set (last_status_update stamped automatically).
// onlyIf: current open-order statuses allowed to change (null = any except the
// blocked list). skipIf: extra statuses to leave untouched. Non-fatal: on
// failure the purchasing save has already succeeded, so we toast + log only.
export async function _syncOpenOrderForPo(order, patch, { onlyIf = null, skipIf = [] } = {}) {
    if (!order || order.request_type !== 'part' || !order.sales_order || !order.part_number) return;
    try {
        const { data: oo } = await db.findOpenOrderBySoAndPart(order.sales_order, order.part_number);
        if (!oo) return;
        const blocked = ['Boxed', 'Shipped', ...skipIf];
        if (onlyIf ? !onlyIf.includes(oo.status) : blocked.includes(oo.status)) return;
        const { error } = await db.updateOpenOrder(oo.id, {
            ...patch,
            last_status_update: new Date().toISOString(),
        });
        if (error) throw error;
    } catch (err) {
        store.showToast('Saved, but the Open Orders board did not sync: ' + err.message);
        logError('_syncOpenOrderForPo', err);
    }
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
        // Stamp the order date when the order is placed; keep any date the purchaser back-dated.
        date_ordered:         form.date_ordered                 || now.split('T')[0],
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

        // Open Orders board: row → 'PO Created' with PO# + expected date as deadline
        await _syncOpenOrderForPo(data, {
            status:       'PO Created',
            wo_po_number: data.po_number,
            ...(data.expected_date ? { deadline: data.expected_date } : {}),
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

        // Open Orders board: parts arrived — row becomes actionable again.
        // Only rows still on the PO path flip; WO-path/Boxed rows are untouched.
        if (newStatus === 'received') {
            await _syncOpenOrderForPo(data, { status: 'New/Picking' },
                { onlyIf: ['PO Requested', 'PO Created'] });
        }
    } catch (err) {
        store.showToast('Failed to record receiving: ' + err.message);
        logError('submitReceiving', err);
    } finally {
        store.purchasingReceiveSaving.value = false;
    }
}
