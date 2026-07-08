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
// Returns the color string to pass to openOrderRowClass.
export function effectiveRowColor(order) {
    return getStaleHighlightColor(order) || order.row_color || null;
}

// openOrderRowClass — Tailwind classes for row bg + left border.
// selected=true gives a white lifted card look with a dark border.
export function openOrderRowClass(color, selected = false) {
    if (selected) return 'bg-indigo-50 border-l-4 border-l-indigo-500 transition-colors cursor-grab';
    const map = {
        orange: 'bg-orange-50 border-l-4 border-l-orange-400',
        yellow: 'bg-yellow-50 border-l-4 border-l-yellow-400',
        pink:   'bg-pink-50   border-l-4 border-l-pink-400',
        blue:   'bg-blue-50   border-l-4 border-l-blue-400',
    };
    return (map[color] || 'bg-white border-l-4 border-l-slate-100') + ' transition-colors';
}

// openOrderColorDotClass — bg class for the color picker trigger dot.
export function openOrderColorDotClass(color) {
    const map = {
        orange: 'bg-orange-400',
        yellow: 'bg-yellow-400',
        pink:   'bg-pink-400',
        blue:   'bg-blue-400',
    };
    return map[color] || 'bg-slate-200';
}

// chuteStatusClass — badge bg+text classes for chute/bracket status values.
export function chuteStatusClass(status) {
    const map = {
        'Ordered':  'bg-purple-100 text-purple-800',
        'In Stock': 'bg-blue-100   text-blue-800',
        'Ready':    'bg-green-100  text-green-800',
        'Complete': 'bg-teal-100   text-teal-800',
        'N/A':      'bg-slate-100  text-slate-500',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
}

// openOrderStatusClass — badge bg+text classes for a status value.
export function openOrderStatusClass(status) {
    const map = {
        'New/Picking':  'bg-blue-100   text-blue-800',
        'In Progress':  'bg-amber-100  text-amber-800',
        'WO Requested': 'bg-purple-100 text-purple-800',
        'PO Requested': 'bg-violet-100 text-violet-800',
        'WO Created':   'bg-indigo-100 text-indigo-800',
        'PO Created':   'bg-indigo-100 text-indigo-800',
        'Boxed':        'bg-green-100  text-green-800',
        'Shipped':      'bg-teal-100   text-teal-800',
        'On Hold':      'bg-red-100    text-red-800',
        'Deleted':      'bg-rose-100   text-rose-800',
    };
    return map[status] || 'bg-slate-100 text-slate-700';
}

// woDeptBadgeClass — Tailwind bg+text classes for a work_orders department badge.
export function woDeptBadgeClass(dept) {
    const map = {
        'Fab':      'bg-amber-100 text-amber-800',
        'Weld':     'bg-red-100   text-red-800',
        'TV Assy':  'bg-blue-100  text-blue-800',
        'TC Assy':  'bg-teal-100  text-teal-800',
    };
    return map[dept] || 'bg-slate-100 text-slate-700';
}

// woStatusBadgeClass — Tailwind bg+text classes for a work_orders status value.
export function woStatusBadgeClass(status) {
    const map = {
        started:   'bg-green-100  text-green-800',
        paused:    'bg-yellow-100 text-yellow-800',
        on_hold:   'bg-red-100    text-red-800',
        completed: 'bg-slate-100  text-slate-500',
    };
    return map[status] || 'bg-slate-100 text-slate-600';
}

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
// If newStatus is 'Shipped', rows are moved to completed_orders and removed from open_orders.
export async function bulkChangeStatus(ids, newStatus) {
    if (!ids.length || !newStatus) return;
    const now = new Date().toISOString();

    if (newStatus === 'Shipped') {
        const toShip = store.openOrders.value.filter(o => ids.includes(o.id));
        const results = await Promise.all(
            toShip.map(o => db.shipOpenOrder({ ...o, status: 'Shipped', last_status_update: now }))
        );
        const failed = results.filter(r => r.error);
        if (failed.length) store.showToast(`Failed to ship ${failed.length} row(s)`);
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

    // Shipping moves the row to completed_orders instead of updating in place
    if (field === 'status' && value === 'Shipped') {
        const order = store.openOrders.value.find(o => o.id === id);
        if (order) {
            const { error } = await db.shipOpenOrder({ ...order, status: 'Shipped', last_status_update: new Date().toISOString() });
            if (error) { store.showToast('Failed to ship: ' + error.message); return; }
            store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
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
    if (!window.confirm(`Delete this row?\n\n${partNumber || 'Unknown part'}\n\n(It can be restored from Completed Orders.)`)) return;
    const order = store.openOrders.value.find(o => o.id === id);
    if (!order) return;
    const { error } = await db.shipOpenOrder({ ...order }, 'Deleted');
    if (error) { store.showToast('Failed to delete: ' + error.message); return; }
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
}

// ── Add Row(s) modal ──────────────────────────────────────────
// cancelAddModal / parsePasteRows / saveOpenOrderRow live in
// pages/open-orders-add.js (split for the 500-line cap).

// ── Request WO / PO from a row ────────────────────────────────

// canRequestFromOpenOrder — true when the row is in a state where requesting
// a WO or PO makes sense (nothing requested/created yet). Input: order row.
export function canRequestFromOpenOrder(order) {
    const status = order?.status || 'New/Picking';
    return status === 'New/Picking' || status === 'On Hold';
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

// openWoDetailPanel — fetch active WOs for a "WO Created" row and open the detail modal.
// Silently returns if status is not "WO Created" or wo_po_number is missing.
export async function openWoDetailPanel(order) {
    if (order.status !== 'WO Created' || !order.wo_po_number) return;
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
