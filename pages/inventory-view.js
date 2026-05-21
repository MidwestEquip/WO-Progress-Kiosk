// ============================================================
// pages/inventory-view.js — Inventory tab logic
//
// Handles: loading items, adding/editing/deleting parts, recording pulls,
//          viewing pull history.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadInventoryItems — fetch all rows for the current tab and update store.
// Called on tab entry and after every mutation.
export async function loadInventoryItems() {
    store.inventoryLoading.value = true;
    try {
        const { data, error } = await db.fetchInventory(store.inventoryTab.value);
        if (error) throw error;
        store.inventoryItems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load inventory: ' + err.message);
        logError('loadInventoryItems', err, { tab: store.inventoryTab.value });
        store.inventoryItems.value = [];
    } finally {
        store.inventoryLoading.value = false;
    }
}

// switchInventoryTab — change active tab and reload items.
// Input: tab ('chute'|'hitch'|'engine'|'hardware'|'hoses').
export async function switchInventoryTab(tab) {
    store.inventoryTab.value    = tab;
    store.inventorySearch.value = '';
    await loadInventoryItems();
}

// ── Pull form ─────────────────────────────────────────────────

// openPullForm — open pull form for a specific inventory item.
export function openPullForm(item) {
    store.pullFormTarget.value = item;
    store.pullForm.value = {
        name:         '',
        qty_pulled:   '',
        new_location: '',
        where_used:   '',
        date_pulled:  new Date().toISOString().slice(0, 10)
    };
    store.pullFormErrors.value = { name: false, qty_pulled: false };
    store.pullFormOpen.value   = true;
}

export function closePullForm() {
    store.pullFormOpen.value   = false;
    store.pullFormTarget.value = null;
}

// submitPull — validate, insert pull log row + decrement qty, reload.
export async function submitPull() {
    const form   = store.pullForm.value;
    const errors = { name: false, qty_pulled: false };
    if (!form.name.trim())                                errors.name       = true;
    if (!form.qty_pulled || parseFloat(form.qty_pulled) <= 0) errors.qty_pulled = true;
    store.pullFormErrors.value = errors;
    if (errors.name || errors.qty_pulled) return;

    store.loading.value = true;
    try {
        const { error } = await db.recordPull(
            store.inventoryTab.value,
            store.pullFormTarget.value.id,
            form
        );
        if (error) throw error;
        store.pullFormOpen.value = false;
        store.showToast('Pull recorded.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to record pull: ' + err.message, 'error');
        logError('submitPull', err, { id: store.pullFormTarget.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── Add item form ─────────────────────────────────────────────

export function openAddItemForm() {
    store.addItemForm.value       = { part_number: '', description: '', qty: 0, location: '', refill_location: '' };
    store.addItemFormErrors.value = { part_number: false };
    store.addItemFormOpen.value   = true;
}

export function closeAddItemForm() {
    store.addItemFormOpen.value = false;
}

// submitAddItem — validate + insert new part row, reload.
export async function submitAddItem() {
    const form = store.addItemForm.value;
    if (!form.part_number.trim()) {
        store.addItemFormErrors.value.part_number = true;
        return;
    }
    store.loading.value = true;
    try {
        const { error } = await db.addInventoryItem(store.inventoryTab.value, form);
        if (error) throw error;
        store.addItemFormOpen.value = false;
        store.showToast('Part added.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to add part: ' + err.message, 'error');
        logError('submitAddItem', err, { tab: store.inventoryTab.value });
    } finally {
        store.loading.value = false;
    }
}

// ── Edit item form ────────────────────────────────────────────

// openEditItemForm — pre-fill edit form with current row values.
export function openEditItemForm(item) {
    store.editItemFormTarget.value = item;
    store.editItemForm.value       = {
        part_number:     item.part_number,
        description:     item.description     || '',
        qty:             item.qty,
        location:        item.location        || '',
        refill_location: item.refill_location || ''
    };
    store.editItemFormErrors.value = { part_number: false };
    store.editItemFormOpen.value   = true;
}

export function closeEditItemForm() {
    store.editItemFormOpen.value   = false;
    store.editItemFormTarget.value = null;
}

// submitEditItem — validate + update row, reload.
export async function submitEditItem() {
    const form = store.editItemForm.value;
    if (!form.part_number.trim()) {
        store.editItemFormErrors.value.part_number = true;
        return;
    }
    store.loading.value = true;
    try {
        const { error } = await db.updateInventoryItem(
            store.inventoryTab.value,
            store.editItemFormTarget.value.id,
            form
        );
        if (error) throw error;
        store.editItemFormOpen.value = false;
        store.showToast('Part updated.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to update part: ' + err.message, 'error');
        logError('submitEditItem', err, { id: store.editItemFormTarget.value?.id });
    } finally {
        store.loading.value = false;
    }
}

// ── Delete ────────────────────────────────────────────────────

// confirmDeleteInventoryItem — confirm dialog, then hard delete (pull log cascades).
export async function confirmDeleteInventoryItem(item) {
    if (!confirm(`Delete ${item.part_number}? Pull history will also be removed. This cannot be undone.`)) return;
    store.loading.value = true;
    try {
        const { error } = await db.deleteInventoryItem(store.inventoryTab.value, item.id);
        if (error) throw error;
        store.showToast('Part deleted.', 'success');
        await loadInventoryItems();
    } catch (err) {
        store.showToast('Failed to delete part: ' + err.message, 'error');
        logError('confirmDeleteInventoryItem', err, { id: item.id });
    } finally {
        store.loading.value = false;
    }
}

// ── Pull history ──────────────────────────────────────────────

// openPullHistory — load pull log for an item and show history modal.
export async function openPullHistory(item) {
    store.pullHistoryTarget.value  = item;
    store.pullHistoryItems.value   = [];
    store.pullHistoryLoading.value = true;
    store.pullHistoryOpen.value    = true;
    try {
        const { data, error } = await db.fetchPullHistory(store.inventoryTab.value, item.id);
        if (error) throw error;
        store.pullHistoryItems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load pull history: ' + err.message, 'error');
        logError('openPullHistory', err, { id: item.id });
    } finally {
        store.pullHistoryLoading.value = false;
    }
}

export function closePullHistory() {
    store.pullHistoryOpen.value   = false;
    store.pullHistoryTarget.value = null;
    store.pullHistoryItems.value  = [];
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
