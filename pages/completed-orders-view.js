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
// Also resets the window to the most recent 30 days so a revisit never inherits
// a huge window widened in an earlier session.
export function enterCompletedOrdersView() {
    store.completedOrdersFilter.value = '';  // stale filter must never silently hide rows
    store.completedOrdersDays.value   = 30;
    store.currentView.value = 'completed_orders';
}

// _windowStartIso — ISO timestamp N days back from now (start of the window).
function _windowStartIso(days) {
    return new Date(Date.now() - days * 86400000).toISOString();
}

// loadCompletedOrders — fetch the current window of completed rows (oldest
// shipped first) and refresh the count of still-older rows. Each call refetches
// the whole widened window rather than appending a page, so the list can never
// hold duplicates or drift out of sort order.
export async function loadCompletedOrders() {
    store.completedOrdersLoading.value = true;
    try {
        const since = _windowStartIso(store.completedOrdersDays.value);
        const { data, error } = await db.fetchCompletedOrders(since);
        if (error) throw error;
        store.completedOrders.value = data || [];
        // Non-fatal: a failed count only costs the "Load more" button.
        const { count, error: countErr } = await db.countCompletedOrdersBefore(since);
        store.completedOrdersOlderCount.value = countErr ? 0 : (count || 0);
    } catch (err) {
        store.showToast('Failed to load completed orders: ' + err.message);
        logError('loadCompletedOrders', err);
    } finally {
        store.completedOrdersLoading.value = false;
    }
}

// loadMoreCompletedOrders — widen the window by another 30 days and reload.
// Uses its own MoreLoading flag so the table stays on screen while it runs.
export async function loadMoreCompletedOrders() {
    if (store.completedOrdersMoreLoading.value) return;
    store.completedOrdersMoreLoading.value = true;
    const prevDays = store.completedOrdersDays.value;
    try {
        store.completedOrdersDays.value = prevDays + 30;
        const since = _windowStartIso(store.completedOrdersDays.value);
        const { data, error } = await db.fetchCompletedOrders(since);
        if (error) throw error;
        store.completedOrders.value = data || [];
        const { count, error: countErr } = await db.countCompletedOrdersBefore(since);
        store.completedOrdersOlderCount.value = countErr ? 0 : (count || 0);
    } catch (err) {
        store.completedOrdersDays.value = prevDays;  // window never widens on failure
        store.showToast('Failed to load older orders: ' + err.message);
        logError('loadMoreCompletedOrders', err);
    } finally {
        store.completedOrdersMoreLoading.value = false;
    }
}

// ── Inline cell editing (notes, tracking #) ───────────────────

// startCompletedCellEdit — activate inline edit for one Completed Orders cell.
// id: row uuid, field: column name, value: current value to pre-fill.
export function startCompletedCellEdit(id, field, value) {
    store.completedEditingCell.value  = { id, field };
    store.completedEditingValue.value = value ?? '';
}

// cancelCompletedCellEdit — discard edit without saving.
export function cancelCompletedCellEdit() {
    store.completedEditingCell.value  = { id: null, field: null };
    store.completedEditingValue.value = '';
}

// saveCompletedCellEdit — persist the draft value to open_orders_completed and
// update the store row in place. Guard prevents a double-save when blur fires
// after Enter. Blank trims to null. Reloads + toasts on DB failure.
export async function saveCompletedCellEdit(id, field) {
    if (store.completedEditingCell.value.id !== id ||
        store.completedEditingCell.value.field !== field) return;
    const raw   = store.completedEditingValue.value;
    const value = typeof raw === 'string' ? (raw.trim() || null) : (raw || null);

    cancelCompletedCellEdit(); // clear immediately so the UI snaps back

    const { error } = await db.updateCompletedOrder(id, { [field]: value });
    if (error) {
        store.showToast('Failed to save: ' + error.message);
        await loadCompletedOrders();
        return;
    }
    const idx = store.completedOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.completedOrders.value];
        updated[idx]  = { ...updated[idx], [field]: value };
        store.completedOrders.value = updated;
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
