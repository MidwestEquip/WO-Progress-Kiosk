// ============================================================
// pages/inventory-view.js — Inventory view logic (PO Receive)
//
// Handles: the PO Receive sub-view (load pending/received purchasing
//          orders, record receipts, move received orders back to pending).
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// ── Inventory Adjustment (item_master manual counts) ──────────

// enterInventoryAdjustView — open the inventory view in manual-count adjustment mode.
// Search-driven, so no data is preloaded; clears any prior lookup state.
export function enterInventoryAdjustView() {
    store.inventoryMode.value           = 'adjust';
    store.inventoryAdjustSearch.value   = '';
    store.inventoryAdjustResult.value   = null;
    store.inventoryAdjustSearched.value = false;
    store.inventoryAdjustForm.value     = { qty: '', date: new Date().toISOString().slice(0, 10) };
    store.inventoryAdjustErrors.value   = { qty: false };
    store.currentView.value             = 'inventory';
}

// searchItemMasterPart — look up the typed part # in item_master and show its
// current system on-hand + last manual count. Prefills the qty input with the
// existing manual count (if any) so the user sees what they'd overwrite.
export async function searchItemMasterPart() {
    const part = store.inventoryAdjustSearch.value.trim();
    if (!part) return;
    store.inventoryAdjustLoading.value = true;
    store.inventoryAdjustResult.value  = null;
    store.inventoryAdjustErrors.value  = { qty: false };
    try {
        const { data, error } = await db.fetchItemMasterByPart(part);
        if (error) throw error;
        store.inventoryAdjustResult.value = data;
        store.inventoryAdjustForm.value = {
            qty:  data && data.manual_qty_check != null ? data.manual_qty_check : '',
            date: new Date().toISOString().slice(0, 10),
        };
    } catch (err) {
        store.showToast('Lookup failed: ' + err.message, 'error');
        logError('searchItemMasterPart', err, { part });
    } finally {
        store.inventoryAdjustSearched.value = true;
        store.inventoryAdjustLoading.value  = false;
    }
}

// loadPoDetailRealCount — fetch the manual item_master count for the open purchasing
// order's part, for the "Real Count" line in the detail modal's Research tab. Cleared
// first so a prior order's count never lingers; guarded by order id against fast switches.
export async function loadPoDetailRealCount() {
    store.poDetailRealCount.value = null;
    const order = store.purchasingDetailOrder.value;
    const part  = order?.part_number;
    if (!part) return;
    const orderId = order.id;
    const { data, error } = await db.fetchItemMasterByPart(part);
    if (error || !data || data.manual_qty_check == null) return;
    if (store.purchasingDetailOrder.value?.id !== orderId) return; // stale: a different order opened
    store.poDetailRealCount.value = { qty: data.manual_qty_check, date: data.date_manual_count };
}

// submitManualCount — validate qty (finite, ≥ 0) and save the count to the matched
// item_master row by PK id. Reflects the saved values back into the result card.
export async function submitManualCount() {
    const row  = store.inventoryAdjustResult.value;
    const form = store.inventoryAdjustForm.value;
    if (!row) return;
    const qty = Number(form.qty);
    if (form.qty === '' || !Number.isFinite(qty) || qty < 0) {
        store.inventoryAdjustErrors.value = { qty: true };
        return;
    }
    store.inventoryAdjustErrors.value = { qty: false };
    const dateStr = form.date || new Date().toISOString().slice(0, 10);
    store.inventoryAdjustSaving.value = true;
    try {
        const { data, error } = await db.saveManualCount(row.id, qty, dateStr);
        if (error) throw error;
        const saved = (data && data[0]) || {};
        store.inventoryAdjustResult.value = {
            ...row,
            manual_qty_check:  saved.manual_qty_check  ?? qty,
            date_manual_count: saved.date_manual_count ?? dateStr,
            source_of_count:   saved.source_of_count   ?? 'manual',
        };
        store.showToast('Count saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save count: ' + err.message, 'error');
        logError('submitManualCount', err, { id: row.id });
    } finally {
        store.inventoryAdjustSaving.value = false;
    }
}

// ── PO Receive ────────────────────────────────────────────────

// loadPoReceiveOrders — fetch all pending (non-received) purchasing orders into store.
export async function loadPoReceiveOrders() {
    store.poReceiveLoading.value = true;
    try {
        const { data, error } = await db.fetchPoReceiveOrders();
        if (error) throw error;
        store.poReceiveOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load PO receive list: ' + err.message);
        logError('loadPoReceiveOrders', err);
    } finally {
        store.poReceiveLoading.value = false;
    }
}

// loadPoReceivedOrders — fetch received orders into the already-received panel.
export async function loadPoReceivedOrders() {
    store.poReceivedLoading.value = true;
    try {
        const { data, error } = await db.fetchReceivedPoOrders();
        if (error) throw error;
        store.poReceivedOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load received orders: ' + err.message);
        logError('loadPoReceivedOrders', err);
    } finally {
        store.poReceivedLoading.value = false;
    }
}

// unreceivePoOrder — move a received order back to pending (status = ordered).
export async function unreceivePoOrder(order) {
    const now = new Date().toISOString();
    const updates = {
        status:             'ordered',
        qty_received:       null,
        received_by:        null,
        received_at:        null,
        completed_at:       null,
        last_status_update: now,
    };
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, updates);
        if (error) throw error;
        store.poReceivedOrders.value = store.poReceivedOrders.value.filter(o => o.id !== order.id);
        store.poReceiveOrders.value  = [data, ...store.poReceiveOrders.value];
        store.showToast('Order moved back to pending.', 'success');
        db.insertPurchasingEvent({
            orderId:   order.id,
            eventType: 'status_change',
            note:      'Receipt undone — moved back to ordered',
            oldStatus: 'received',
            newStatus: 'ordered',
            createdBy: 'receiving',
        });
    } catch (err) {
        store.showToast('Failed to undo receive: ' + err.message);
        logError('unreceivePoOrder', err);
    }
}

// openPoReceiveItem — select an order and open the receive modal.
export function openPoReceiveItem(order) {
    store.poReceiveItem.value = order;
    store.poReceiveForm.value = { qty_received: '', received_by: '' };
    store.poReceiveOpen.value = true;
}

// closePoReceiveItem — dismiss the receive modal without saving.
export function closePoReceiveItem() {
    store.poReceiveOpen.value = false;
    store.poReceiveItem.value = null;
}

// submitPoReceive — validate, update order status, refresh list.
export async function submitPoReceive() {
    const order       = store.poReceiveItem.value;
    const form        = store.poReceiveForm.value;
    const qtyReceived = parseFloat(form.qty_received) || 0;
    const qtyFull     = parseFloat(order.qty_ordered) || parseFloat(order.qty_needed) || qtyReceived;

    if (qtyReceived <= 0) {
        store.showToast('Enter a quantity received greater than 0.', 'error');
        return;
    }
    if (!form.received_by?.trim()) {
        store.showToast('Enter the name of who received the order.', 'error');
        return;
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

    store.poReceiveSaving.value = true;
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, updates);
        if (error) throw error;

        if (newStatus === 'received') {
            store.poReceiveOrders.value   = store.poReceiveOrders.value.filter(o => o.id !== order.id);
            store.poReceivedOrders.value  = [data, ...store.poReceivedOrders.value];
        } else {
            store.poReceiveOrders.value = store.poReceiveOrders.value.map(o => o.id === data.id ? data : o);
        }
        // Update completed tab in place (order was ordered/partially_received, now received/partial)
        store.purchasingCompletedOrders.value = store.purchasingCompletedOrders.value.map(
            o => o.id === data.id ? data : o
        );

        store.poReceiveOpen.value = false;
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
        logError('submitPoReceive', err);
    } finally {
        store.poReceiveSaving.value = false;
    }
}
