// ============================================================
// pages/open-orders-view.js — Open Orders (Shipping) view logic
//
// Handles: loading orders, per-section sort, row color changes,
//          Add Row modal (manual + paste), inline cell save.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { getStaleHighlightColor, openOrderGroupClass } from '../libs/utils.js';
import { OPEN_ORDER_STATUS_LABELLED, APP_LOCATION } from '../libs/config.js';
import { logError } from '../libs/db-shared.js';

// Re-exported so the shipping expose binds it from this domain file (like the
// other presentation-class helpers) without importing utils.js directly.
export { openOrderGroupClass };

// loadOpenOrders — fetch all open_orders rows into store.
export async function loadOpenOrders() {
    store.openOrdersLoading.value = true;
    try {
        const { data, error } = await db.fetchOpenOrders();
        if (error) throw error;
        store.openOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load open orders: ' + err.message);
        logError('loadOpenOrders', err);
    } finally {
        store.openOrdersLoading.value = false;
    }
}

// _openOrderRowsEqualIgnoringVolatile — self-echo check; ignores the
// server-stamped updated_at so our own saves (already applied locally) don't
// force a re-render.
function _openOrderRowsEqualIgnoringVolatile(a, b) {
    if (!a || !b) return false;
    const strip = ({ updated_at, ...rest }) => rest;
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// reconcileOpenOrderRealtime — surgical in-place merge of a realtime open_orders
// change into store.openOrders, replacing the old full-list reload that reset
// scroll/focus on every cell edit. The open_orders table holds only active rows
// (shipped/deleted rows move to open_orders_completed), so every row belongs —
// no status predicate needed; the view computeds handle section ordering.
// Input: realtime payload { eventType, new: row, old }. No return value.
export function reconcileOpenOrderRealtime({ eventType, new: row, old }) {
    const list = store.openOrders.value;
    if (eventType === 'DELETE') {
        const id = old?.id;
        if (id != null) store.openOrders.value = list.filter(o => o.id !== id);
        return;
    }
    if (!row) return;
    const idx = list.findIndex(o => o.id === row.id);
    if (idx === -1) {
        store.openOrders.value = [...list, row];
        return;
    }
    if (_openOrderRowsEqualIgnoringVolatile(list[idx], row)) return; // self-echo, no-op
    const next = [...list];
    next[idx]  = row;
    store.openOrders.value = next;
}

// setSectionSort — toggle sort field/dir for one section.
// section: 'emergency'|'freight'|'trac_vac'|'tru_cut', field: column name string.
export function setSectionSort(section, field) {
    const cur = store.openOrdersSort.value[section];
    store.openOrdersSort.value = {
        ...store.openOrdersSort.value,
        [section]: {
            field,
            dir: cur.field === field && cur.dir === 'asc' ? 'desc' : 'asc',
        }
    };
}

// openOrderSortIcon — returns ↑, ↓, or ↕ for a given section + field.
export function openOrderSortIcon(section, field) {
    const cur = store.openOrdersSort.value[section];
    if (cur.field !== field) return '↕';
    return cur.dir === 'asc' ? '↑' : '↓';
}

// setRowColor — persist row_color to DB and update store in-place.
// color: 'orange'|'yellow'|'pink'|'blue'|null (null = clear).
export async function setRowColor(id, color) {
    store.openOrderColorPickerRow.value = null;
    const { error } = await db.updateOpenOrder(id, { row_color: color || null });
    if (error) { store.showToast('Failed to set color: ' + error.message); return; }
    const idx = store.openOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.openOrders.value];
        updated[idx]  = { ...updated[idx], row_color: color || null };
        store.openOrders.value = updated;
    }
}

// effectiveRowColor — stale highlight takes priority over manual row_color.
// A backordered line gets a distinct 'backorder' stripe (below stale escalation,
// which must still signal an overdue backorder; above the manual owner colors).
// Returns the color string to pass to openOrderRowClass.
export function effectiveRowColor(order) {
    return getStaleHighlightColor(order) || (order?.backordered ? 'backorder' : null) || order.row_color || null;
}

// openOrderRowClass — Tailwind classes for row bg + left color stripe.
// The stripe is an INSET left box-shadow (not a border) so the same-SO grouping
// box (openOrderGroupClass uses !border-* on the left edge) can't override it —
// on grouped rows the black outline and the color stripe are now both visible.
// selected=true gives a white lifted card look with an indigo stripe.
export function openOrderRowClass(color, selected = false) {
    if (selected) return 'bg-indigo-50 shadow-[inset_6px_0_0_0_#6366f1] transition-colors cursor-grab';
    const map = {
        orange: 'bg-orange-50 shadow-[inset_6px_0_0_0_#fb923c]',
        yellow: 'bg-yellow-50 shadow-[inset_6px_0_0_0_#eab308]',
        // amber/red are stale-escalation colors (levels 2/3), not manual picks.
        amber:  'bg-amber-100 shadow-[inset_6px_0_0_0_#d97706]',
        red:    'bg-red-200   shadow-[inset_6px_0_0_0_#b91c1c]',
        pink:   'bg-pink-50   shadow-[inset_6px_0_0_0_#f472b6]',
        blue:   'bg-blue-50   shadow-[inset_6px_0_0_0_#60a5fa]',
        // backorder — violet, distinct from the four owner colors and the stale tints.
        backorder: 'bg-violet-50 shadow-[inset_6px_0_0_0_#7c3aed]',
    };
    return (map[color] || 'bg-white shadow-[inset_6px_0_0_0_#f1f5f9]') + ' transition-colors';
}

// Pure badge/class helpers (openOrderColorDotClass, chuteStatusClass,
// openOrderStatusClass, woDeptBadgeClass, woStatusBadgeClass) moved to
// libs/utils-open-orders.js — they are stateless input→class-string maps and
// belong with the other pure helpers. expose-shipping.js imports them from
// utils.js now.

// toggleOpenOrderExpand — toggle the expanded state of a stacked column (quotes or boxes) for one row.
// col: 'quotes' | 'boxes'
export function toggleOpenOrderExpand(id, col) {
    const cur = store.openOrderExpandedCols.value;
    store.openOrderExpandedCols.value = {
        ...cur,
        [id]: { ...(cur[id] || {}), [col]: !cur[id]?.[col] }
    };
}

// bulkChangeStatus — update status on all selected rows in parallel, then clear selection.
// ids: array of row uuids, newStatus: status string.
// If newStatus is 'Shipped' or 'Labelled', rows are moved to completed_orders
// (stamped 'Shipped') and removed from open_orders.
export async function bulkChangeStatus(ids, newStatus) {
    if (!ids.length || !newStatus) return;
    const now = new Date().toISOString();

    if (newStatus === 'Shipped' || newStatus === OPEN_ORDER_STATUS_LABELLED) {
        const toShip = store.openOrders.value.filter(o => ids.includes(o.id));
        const results = await Promise.all(
            toShip.map(o => db.shipOpenOrder({ ...o, status: 'Shipped', last_status_update: now }))
        );
        const failed = results.filter(r => r.error);
        if (failed.length) store.showToast(`Failed to ship ${failed.length} row(s)`);
        const ledgerFails = results.filter(r => !r.error && r.ledgerError).length;
        if (ledgerFails) store.showToast(`${ledgerFails} shipped row(s) did not record to the inventory ledger`);
        store.openOrders.value = store.openOrders.value.filter(o => !ids.includes(o.id));
    } else {
        const results = await Promise.all(
            ids.map(id => db.updateOpenOrder(id, { status: newStatus, last_status_update: now }))
        );
        const failed = results.filter(r => r.error);
        if (failed.length) store.showToast(`Failed to update ${failed.length} row(s)`);
        store.openOrders.value = store.openOrders.value.map(o =>
            ids.includes(o.id) ? { ...o, status: newStatus, last_status_update: now } : o
        );
    }

    store.openOrderSelectedIds.value = [];
    store.openOrderBulkStatus.value  = '';
}

// openOrderHasLine3 — true if this row has supplementary line-3 data.
// holding_bin now in Holding Bin col; chute/bracket now in Status col;
// weight now lives only in the DIMS/Wt col; only override remains here.
export function openOrderHasLine3(order) {
    return !!order.override;
}

// ── Inline cell editing ───────────────────────────────────────

// startCellEdit — activate inline edit for one cell.
// id: row uuid, field: column name, value: current value to pre-fill.
export function startCellEdit(id, field, value) {
    store.openOrderEditingCell.value  = { id, field };
    store.openOrderEditingValue.value = value ?? '';
}

// requestToShipEdit — open the confirm gate before editing the To Ship / order qty.
// id: row uuid, value: current to_ship to pre-fill once confirmed.
export function requestToShipEdit(id, value) {
    store.openOrderQtyConfirm.value = { id, value };
}

// confirmToShipEdit — user confirmed; close the gate and start the inline qty edit.
export function confirmToShipEdit() {
    const { id, value } = store.openOrderQtyConfirm.value;
    store.openOrderQtyConfirm.value = { id: null, value: null };
    if (id != null) startCellEdit(id, 'to_ship', value);
}

// cancelToShipEdit — user declined; close the gate without editing.
export function cancelToShipEdit() {
    store.openOrderQtyConfirm.value = { id: null, value: null };
}

// cancelCellEdit — discard edit without saving.
export function cancelCellEdit() {
    store.openOrderEditingCell.value  = { id: null, field: null };
    store.openOrderEditingValue.value = '';
}

// saveCellEdit — persist the current draft value to DB and update store in-place.
// Clears edit state immediately for snappy UX; reloads on DB failure.
// Guard at top prevents double-save when blur fires after Enter (Vue unmounts input on next tick).
export async function saveCellEdit(id, field) {
    if (store.openOrderEditingCell.value.id !== id ||
        store.openOrderEditingCell.value.field !== field) return;
    const raw = store.openOrderEditingValue.value;

    // Coerce value to the correct type for this field
    let value;
    if (field === 'to_ship' || field === 'qty_pulled') {
        value = raw !== '' && raw !== null ? Number(raw) : null;
    } else if (field === 'part_number') {
        const trimmed = String(raw).trim().toUpperCase();
        if (!trimmed) { cancelCellEdit(); return; }  // required — don't save blank
        value = trimmed;
    } else {
        value = typeof raw === 'string' ? (raw.trim() || null) : (raw || null);
    }

    cancelCellEdit(); // clear immediately so the UI snaps back

    // Shipping (or 'Labelled') moves the row to completed_orders (stamped
    // 'Shipped') instead of updating in place.
    if (field === 'status' && (value === 'Shipped' || value === OPEN_ORDER_STATUS_LABELLED)) {
        const order = store.openOrders.value.find(o => o.id === id);
        if (order) {
            const { error, ledgerError } = await db.shipOpenOrder({ ...order, status: 'Shipped', last_status_update: new Date().toISOString() });
            if (error) { store.showToast('Failed to ship: ' + error.message); return; }
            if (ledgerError) store.showToast('Shipped, but inventory ledger did not record: ' + ledgerError.message);
            store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
        }
        return;
    }

    // Updated Bin: entering a new "Upd" value promotes it to the canonical bin
    // location (store_bin) and clears the pending update, so the row shows the
    // new bin next time. A blank "Upd" is just a normal clear (handled below).
    if (field === 'update_store_bin' && value) {
        // Ask before promoting — confirm makes it the canonical bin & clears the
        // pending field; decline keeps it as a pending "Updated Bin" suggestion.
        const promote = window.confirm(`Update the bin location for this part to:\n\n${value}?`);
        const binUpdates = promote
            ? { store_bin: value, update_store_bin: null }
            : { update_store_bin: value };
        const { error } = await db.updateOpenOrder(id, binUpdates);
        if (error) { store.showToast('Failed to save: ' + error.message); await loadOpenOrders(); return; }
        const bIdx = store.openOrders.value.findIndex(o => o.id === id);
        if (bIdx !== -1) {
            const updated = [...store.openOrders.value];
            updated[bIdx]  = { ...updated[bIdx], ...binUpdates };
            store.openOrders.value = updated;
        }
        return;
    }

    const updates = { [field]: value };
    if (field === 'status') updates.last_status_update = new Date().toISOString();
    if (field === 'chute_status' || field === 'bracket_adapter_status')
        updates.chute_bracket_last_updated = new Date().toISOString();

    const { error } = await db.updateOpenOrder(id, updates);
    if (error) { store.showToast('Failed to save: ' + error.message); await loadOpenOrders(); return; }

    const idx = store.openOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.openOrders.value];
        updated[idx]  = { ...updated[idx], ...updates };
        store.openOrders.value = updated;
    }
}

// deleteOpenOrder — confirm then move the row to Completed Orders with status
// 'Deleted' (recoverable via the Restore button there). No hard deletes.
// id: row uuid, partNumber: shown in the confirm dialog.
export async function deleteOpenOrder(id, partNumber) {
    if (store.sessionRole.value !== 'manager') {
        store.showToast('Manager sign-in required to delete rows.');
        return;
    }
    if (!window.confirm(`Delete this row?\n\n${partNumber || 'Unknown part'}\n\n(It can be restored from Completed Orders.)`)) return;
    const order = store.openOrders.value.find(o => o.id === id);
    if (!order) return;
    const { error, ledgerError } = await db.shipOpenOrder({ ...order }, 'Deleted');
    if (error) { store.showToast('Failed to delete: ' + error.message); return; }
    if (ledgerError) store.showToast('Deleted, but inventory ledger did not record: ' + ledgerError.message);
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
}

// cancelOpenOrder — confirm then move the row to Completed Orders with status
// 'Cancelled' (customer cancelled the line; recoverable via Restore there).
// Unlike delete, available to all roles. id: row uuid, partNumber: for the dialog.
export async function cancelOpenOrder(id, partNumber) {
    if (!window.confirm(`Cancel this row?\n\n${partNumber || 'Unknown part'}\n\n(It moves to Completed Orders as Cancelled and can be restored.)`)) return;
    const order = store.openOrders.value.find(o => o.id === id);
    if (!order) return;
    const { error, ledgerError } = await db.shipOpenOrder({ ...order }, 'Cancelled');
    if (error) { store.showToast('Failed to cancel: ' + error.message); return; }
    if (ledgerError) store.showToast('Cancelled, but inventory ledger did not record: ' + ledgerError.message);
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
}

// moveSalesOrderToFreight — move every open-order row sharing this row's sales
// order (SO#) into the Freight section (order_type='freight'). A row with no SO#
// moves only itself. Reversible by dragging back to another section.
// order: the clicked open_orders row.
export async function moveSalesOrderToFreight(order) {
    if (!order) return;
    const so   = (order.sales_order || '').trim();
    const rows = so
        ? store.openOrders.value.filter(o => (o.sales_order || '').trim() === so && o.order_type !== 'freight')
        : store.openOrders.value.filter(o => o.id === order.id && o.order_type !== 'freight');
    if (!rows.length) { store.showToast('Already in Freight Orders.'); return; }

    const label = so
        ? `SO# ${so} (${rows.length} row${rows.length > 1 ? 's' : ''})`
        : (order.part_number || 'this row');
    if (!window.confirm(`Move ${label} to Freight Orders?`)) return;

    const ids     = rows.map(r => r.id);
    const results = await Promise.all(ids.map(id => db.updateOpenOrder(id, { order_type: 'freight' })));
    const failed  = results.filter(r => r.error);
    if (failed.length) { store.showToast(`Failed to move ${failed.length} row(s)`); }

    store.openOrders.value = store.openOrders.value.map(o =>
        ids.includes(o.id) ? { ...o, order_type: 'freight' } : o
    );
}

// ── Add Row(s) modal ──────────────────────────────────────────
// cancelAddModal / parsePasteRows / saveOpenOrderRow live in
// pages/open-orders-add.js (split for the 500-line cap).

// ── Request WO / PO from a row ────────────────────────────────

// canRequestFromOpenOrder — true when the row is in a state where requesting
// a WO or PO makes sense (nothing requested/created yet). Input: order row.
export function canRequestFromOpenOrder(order) {
    const status = order?.status || 'New';
    return status === 'New' || status === 'New/Picking' || status === 'On Hold';
}

// requestWoFromOpenOrder — pre-fill the WO Request form from an open order row
// and navigate to the WO Request view. On submit, the existing SO#+part sync
// flips this row to 'WO Requested'. Navigation mirrors enterWoRequestView
// (page files never import each other, so the three store sets are inlined).
export function requestWoFromOpenOrder(order) {
    store.woRequestForm.value = {
        part_number:        (order.part_number || '').trim().toUpperCase(),
        description:        order.description  || '',
        sales_order_number: order.sales_order  || '',
        qty_on_order:       order.to_ship      ?? '',
        qty_in_stock: '', qty_used_per_unit: '',
        submitted_by: '', is_assembly: false,
    };
    store.woRequestFormErrors.value = { part_number: false, qty_in_stock: false, qty_used_per_unit: false, submitted_by: false };
    store.woRequestSoHint.value     = null;
    store.woRequestActiveWos.value  = { part: '', items: [] };
    store.splashLevel.value    = 1;
    store.splashCategory.value = 'production';
    store.currentView.value    = 'wo_request';
}

// requestPoFromOpenOrder — pre-fill the PO Request form (Part type) from an
// open order row and navigate to the PO Requests view. Status sync back to
// 'PO Requested' lands with the purchasing-side sync patch.
export function requestPoFromOpenOrder(order) {
    store.purchasingRequestForm.value = {
        request_type: 'part', requested_by: '', needed_by: '',
        ship_to:      APP_LOCATION,
        qty_needed:   order.to_ship ?? '',
        requester_notes: '',
        part_number:  (order.part_number || '').trim().toUpperCase(),
        description:  order.description || '',
        sales_order:  order.sales_order || '',
        estimated_qty_in_stock: '', request_location: '',
        bin_location: order.store_bin || '',
        current_production_run: '',
        supply_item_name: '', supply_category: '',
        material_type: 'Carbon', steel_shape: '',
        material_description: '', material_length: '',
    };
    store.purchasingRequestFormErrors.value = {};
    store.splashLevel.value    = 1;
    store.splashCategory.value = 'purchasing';
    store.currentView.value    = 'po_request';
}

// openWoDetailPanel — fetch active WOs for a row's WO/PO # and open the detail modal.
// Silently returns if wo_po_number is missing (nothing to look up).
export async function openWoDetailPanel(order) {
    if (!order.wo_po_number) return;
    store.openOrderWoPanel.value = order;
    store.openOrderWoPanelOrders.value = [];
    store.openOrderWoPanelLoading.value = true;
    try {
        const { data, error } = await db.fetchWorkOrdersByWoNumber(order.wo_po_number);
        if (error) throw error;
        store.openOrderWoPanelOrders.value = data || [];
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

// goToActiveWo — jump from an open-order row to the live, editable WO on its
// department dashboard. Looks up the active WO by wo_po_number to learn its
// department, then loads that dept's Active WOs (full field set) filtered to the
// WO# so the operator can open it and edit. order: the clicked open_orders row.
export async function goToActiveWo(order) {
    store.openOrderWoMenuRow.value = null;
    const woNum = (order.wo_po_number || '').trim();
    if (!woNum) return;
    try {
        const { data, error } = await db.fetchWorkOrdersByWoNumber(woNum);
        if (error) throw error;
        let wos = data || [];
        // Pending WO (created, awaiting official Alere WO#): the shown number is the
        // internal job_number, so fall back to a job_number lookup (active rows only).
        if (!wos.length) {
            const jr = await db.fetchAllWorkOrdersByJobNumber(woNum);
            if (jr.error) throw jr.error;
            wos = (jr.data || []).filter(w => w.status !== 'completed');
        }
        if (!wos.length) { store.showToast(`No active WO found for #${woNum} — it may be completed or not started.`); return; }
        const dept = wos[0].department;
        if (!dept) { store.showToast('That WO has no department set.'); return; }

        // Navigate to the department dashboard, filtered to this WO#.
        store.selectedDept.value = dept;
        store.dashSearch.value   = woNum;
        store.currentView.value  = 'dashboard';
        store.loading.value      = true;
        const [ordRes, partsSet] = await Promise.all([
            db.fetchDeptOrders(dept),
            db.fetchPartsWithFiles()
        ]);
        if (ordRes.error) throw ordRes.error;
        store.orders.value         = ordRes.data || [];
        store.partsWithFiles.value = partsSet;
    } catch (err) {
        store.showToast('Failed to open WO: ' + err.message);
        logError('goToActiveWo', err);
    } finally {
        store.loading.value = false;
    }
}

// loadReminderEmail — read saved reminder email from app_settings into store on view enter.
export async function loadReminderEmail() {
    const val = await db.fetchAppSetting('reminder_email');
    store.reminderEmail.value = val || '';
}

// saveReminderEmail — persist current store value and close modal.
export async function saveReminderEmail() {
    store.reminderEmailSaving.value = true;
    try {
        const { error } = await db.upsertAppSetting('reminder_email', store.reminderEmail.value.trim());
        if (error) throw error;
        store.reminderEmailModalOpen.value = false;
        store.showToast('Reminder email saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save: ' + err.message, 'error');
        logError('saveReminderEmail', err);
    } finally {
        store.reminderEmailSaving.value = false;
    }
}
