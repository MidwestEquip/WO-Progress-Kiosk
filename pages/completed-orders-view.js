// ============================================================
// pages/completed-orders-view.js — Completed (Shipped) Orders view logic
//
// Handles: loading completed orders, restoring a row to open orders,
//          entering the view. Imports from store + db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { buildOpenOrderRestoreTxns } from '../libs/utils.js';
import { NATIVE_CUTOVER_DATE } from '../libs/config.js';
import { logError } from '../libs/db-shared.js';

// enterCompletedOrdersView — navigate to the completed orders view.
export function enterCompletedOrdersView() {
    store.currentView.value = 'completed_orders';
}

// loadCompletedOrders — fetch all completed_orders rows (oldest shipped first).
export async function loadCompletedOrders() {
    store.completedOrdersLoading.value = true;
    try {
        const { data, error } = await db.fetchCompletedOrders();
        if (error) throw error;
        store.completedOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load completed orders: ' + err.message);
        logError('loadCompletedOrders', err);
    } finally {
        store.completedOrdersLoading.value = false;
    }
}

// restoreCompletedOrder — move a row from completed_orders back to open_orders.
// Resets status to 'New' and clears shipped_at.
export async function restoreCompletedOrder(id) {
    if (!window.confirm('Restore this row to Open Orders?')) return;
    const row = store.completedOrders.value.find(o => o.id === id);
    if (!row) return;

    // Fresh board id generated HERE (not by insertOpenOrders) so the ledger
    // compensation below is keyed on a known id, and a lost-ack retry inside
    // this call reuses the same id (board + ledger both conflict-ignore).
    // Invariant the ledger key scheme depends on: every restore mints a NEW
    // board id — never reuse original_id.
    const { id: cId, original_id, shipped_at, created_at, updated_at, ...fields } = row;
    const freshId = crypto.randomUUID();
    const { error: insertErr } = await db.insertOpenOrders([{
        ...fields,
        id:                freshId,
        status:            'New',
        last_status_update: new Date().toISOString(),
    }]);
    if (insertErr) { store.showToast('Failed to restore: ' + insertErr.message); return; }

    // Ledger compensation fires once the board insert succeeded (the insert is
    // the inventory-affecting event), independent of the completed-row delete:
    // Shipped → SO/S reversal (stock back in); Deleted/Cancelled → re-book SO/O.
    _recordRestoreTxns(row, freshId); // non-fatal, not awaited

    const { error: deleteErr } = await db.deleteCompletedOrder(id);
    if (deleteErr) { store.showToast('Restored but failed to remove from Completed: ' + deleteErr.message); return; }

    store.completedOrders.value = store.completedOrders.value.filter(o => o.id !== id);
    store.showToast('Row restored to Open Orders.', 'success');
}

// _recordRestoreTxns — non-fatal native ledger compensation for a restore.
// Builder rules (utils.js): Shipped rows shipped before the cutover are
// skipped (no SO/S ever existed); pre-feature rows without original_id skip.
async function _recordRestoreTxns(completedRow, freshId) {
    try {
        const txns = buildOpenOrderRestoreTxns(completedRow, freshId, NATIVE_CUTOVER_DATE);
        if (!txns.length) return;
        const { error } = await db.insertInventoryTxns(txns);
        if (error) throw error;
    } catch (err) {
        store.showToast('Restored, but inventory ledger did not record: ' + err.message);
        logError('_recordRestoreTxns', err, { id: completedRow?.id });
    }
}
