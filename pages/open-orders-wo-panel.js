// ============================================================
// pages/open-orders-wo-panel.js — Open Orders → WO drill-down
//
// Handles: the WO/PO # cell click (single = drill down, double = edit), the WO
//          detail picker panel, and launching the real work screen IN PLACE as
//          an 85% overlay so closing it returns the user to the board untouched.
// Split out of pages/open-orders-view.js (500-line cap).
//
// NOTE: this file imports the three work-screen entry functions from
// pages/dashboard-*.js — a deliberate, user-approved page→page edge (same
// precedent as open-orders-wo-sync.js). The alternative is duplicating the
// department dispatch and the panel-priming logic, which is worse.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError, DEPT_CANONICAL } from '../libs/db-shared.js';
import { openActionPanel }  from './dashboard-view.js';
import { openTcAssyEntry }  from './dashboard-tc.js';
import { openTvAssyEntry }  from './dashboard-tv.js';

// A single click drills into the WO; a double click edits the WO # instead. The
// click handler waits this long before acting so a double click can cancel it.
const WO_CELL_CLICK_DELAY_MS = 250;
let _woCellClickTimer = null;

// onWoCellClick — single click on a row's WO/PO # value. Deferred so that
// cancelWoCellClick() (fired by @dblclick) can win the race. order: the row.
export function onWoCellClick(order) {
    clearTimeout(_woCellClickTimer);
    _woCellClickTimer = setTimeout(() => openWoDetailPanel(order), WO_CELL_CLICK_DELAY_MS);
}

// cancelWoCellClick — kill the pending single-click drill-down. Called from the
// cell's @dblclick handler, which also starts the inline WO # edit.
export function cancelWoCellClick() {
    clearTimeout(_woCellClickTimer);
    _woCellClickTimer = null;
}

// openWoDetailPanel — fetch active WOs for a row's WO/PO # and drill into them.
// Exactly one active WO (the common case) skips the picker entirely and opens its
// work screen; two or more (one row per department) show the picker so the user
// chooses. Silently returns if wo_po_number is missing (nothing to look up).
export async function openWoDetailPanel(order) {
    if (!order.wo_po_number) return;
    store.openOrderWoPanel.value = order;
    store.openOrderWoPanelOrders.value = [];
    store.openOrderWoPanelLoading.value = true;
    try {
        const { data, error } = await db.fetchWorkOrdersByWoNumber(order.wo_po_number);
        if (error) throw error;
        let wos = data || [];
        // Pending WO (approved, awaiting official Alere WO#): the shown number is the
        // internal job_number, so fall back to a job_number lookup (active rows only).
        if (!wos.length) {
            const jr = await db.fetchAllWorkOrdersByJobNumber(order.wo_po_number);
            if (jr.error) throw jr.error;
            wos = (jr.data || []).filter(w => w.status !== 'completed');
        }
        store.openOrderWoPanelOrders.value = wos;
        // Single department — nothing to choose from, so go straight to the work
        // screen. openWoWorkPanel closes the picker itself.
        if (wos.length === 1) {
            store.openOrderWoPanelLoading.value = false;
            await openWoWorkPanel(wos[0]);
        }
    } catch (err) {
        store.showToast('Failed to load WO details: ' + err.message);
        logError('openWoDetailPanel', err);
    } finally {
        store.openOrderWoPanelLoading.value = false;
    }
}

// closeWoDetailPanel — dismiss the WO detail modal and clear its data.
export function closeWoDetailPanel() {
    store.openOrderWoPanel.value = null;
    store.openOrderWoPanelOrders.value = [];
}

// openWoWorkPanel — open ONE work order's live work screen on top of the Open
// Orders board, exactly as if it had been opened from its department dashboard.
// currentView is deliberately NOT changed: the board stays mounted underneath, so
// closing the screen returns the user to the same scroll position and filters.
// Primes the dashboard state the work screens depend on (selectedDept, orders,
// partsWithFiles) so status updates, undo and the post-save refresh all behave.
// wo: one row from the WO detail picker (a work_orders row).
export async function openWoWorkPanel(wo) {
    if (!wo?.id) return;
    const dept = DEPT_CANONICAL[wo.department] || wo.department;
    if (!dept) { store.showToast('That WO has no department set.'); return; }

    closeWoDetailPanel();
    store.loading.value = true;
    try {
        store.selectedDept.value = dept;
        const [ordRes, partsSet] = await Promise.all([
            db.fetchDeptOrders(dept),
            db.fetchPartsWithFiles()
        ]);
        if (ordRes.error) throw ordRes.error;
        store.orders.value         = ordRes.data || [];
        store.partsWithFiles.value = partsSet;

        // Prefer the freshly loaded row (normalized dept + latest status); fall back
        // to the picker's copy so the screen still opens if the board list missed it.
        const fresh = store.orders.value.find(o => o.id === wo.id) || wo;
        store.openOrderWoOverlay.value = true;
        if      (fresh.department === 'Trac Vac Assy') openTvAssyEntry(fresh);
        else if (fresh.department === 'Tru Cut Assy')  openTcAssyEntry(fresh);
        else                                           openActionPanel(fresh);
    } catch (err) {
        store.openOrderWoOverlay.value = false;
        store.showToast('Failed to open WO: ' + err.message);
        logError('openWoWorkPanel', err, { id: wo.id, dept });
    } finally {
        store.loading.value = false;
    }
}
