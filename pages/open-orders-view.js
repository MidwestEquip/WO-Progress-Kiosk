// ============================================================
// pages/open-orders-view.js — Open Orders (Shipping) view logic
//
// Handles: loading orders, per-section sort, row color changes,
//          Add Row modal (manual + paste), inline cell save.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { detectOpenOrderSection, isChutePart, getStaleHighlightColor } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

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
        'WO Requested': 'bg-purple-100 text-purple-800',
        'PO Requested': 'bg-violet-100 text-violet-800',
        'WO Created':   'bg-indigo-100 text-indigo-800',
        'PO Created':   'bg-indigo-100 text-indigo-800',
        'Boxed':        'bg-green-100  text-green-800',
        'Shipped':      'bg-teal-100   text-teal-800',
        'On Hold':      'bg-red-100    text-red-800',
    };
    return map[status] || 'bg-slate-100 text-slate-700';
}

// moveToSection — update order_type for a row in DB and store in-place.
// id: uuid, newType: 'emergency'|'freight'|'trac_vac'|'tru_cut'
export async function moveToSection(id, newType) {
    const { error } = await db.updateOpenOrder(id, { order_type: newType });
    if (error) { store.showToast('Failed to move row: ' + error.message); return; }
    const idx = store.openOrders.value.findIndex(o => o.id === id);
    if (idx !== -1) {
        const updated = [...store.openOrders.value];
        updated[idx] = { ...updated[idx], order_type: newType };
        store.openOrders.value = updated;
    }
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
// holding_bin now in Holding Bin col; chute/bracket now in Status col; only wt/override remain.
export function openOrderHasLine3(order) {
    return !!(order.weight_lbs || order.override);
}

// ── Inline cell editing ───────────────────────────────────────

// startCellEdit — activate inline edit for one cell.
// id: row uuid, field: column name, value: current value to pre-fill.
export function startCellEdit(id, field, value) {
    store.openOrderEditingCell.value  = { id, field };
    store.openOrderEditingValue.value = value ?? '';
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

// deleteOpenOrder — confirm then permanently remove the row from DB and store.
// id: row uuid, partNumber: shown in the confirm dialog.
export async function deleteOpenOrder(id, partNumber) {
    if (!window.confirm(`Delete this row?\n\n${partNumber || 'Unknown part'}`)) return;
    const { error } = await db.deleteOpenOrder(id);
    if (error) { store.showToast('Failed to delete: ' + error.message); return; }
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== id);
}

// ── Add Row(s) modal ──────────────────────────────────────────

// cancelAddModal — close the Add Row(s) modal and reset all draft state.
export function cancelAddModal() {
    store.openOrderAddModalOpen.value = false;
    store.openOrderAddMode.value = 'manual';
    store.openOrderAddPasteText.value = '';
    store.openOrderAddPasteRows.value = [];
    store.openOrderAddForm.value = {
        part_number: '', to_ship: '', qty_pulled: '', description: '',
        store_bin: '', update_store_bin: '', customer: '', sales_order: '',
        date_entered: new Date().toISOString().split('T')[0], deadline: '', status: 'New/Picking',
        wo_va_notes: '', wo_po_number: '',
    };
    store.openOrderAddFormErrors.value = {};
}

// parsePasteRows — parse tab-delimited text (pasted from Excel) into preview rows.
// Expected column order (11 cols):
//   [0] Part #  [1] To Ship  [2] Qty Pulled  [3] Description
//   [4] Store/Bin  [5] Update Store/Bin  [6] Customer
//   [7] Sales Order #  [8] Date Entered  [9] Status  [10] Notes
// Section is auto-detected from part # prefix (TC → tru_cut, else → trac_vac).
// Blank lines and obvious header rows are skipped.
export function parsePasteRows() {
    const text = store.openOrderAddPasteText.value || '';
    const rows = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const c = trimmed.split('\t');
        const partRaw = (c[0] || '').trim();
        if (!partRaw || partRaw.toLowerCase() === 'part #' || partRaw.toLowerCase() === 'part number') continue;
        const part = partRaw.toUpperCase();
        rows.push({
            part_number:      part,
            to_ship:          (c[1] || '').trim() || null,
            qty_pulled:       (c[2] || '').trim() || null,
            description:      (c[3] || '').trim() || null,
            store_bin:        (c[4] || '').trim() || null,
            update_store_bin: (c[5] || '').trim() || null,
            customer:         (c[6] || '').trim() || null,
            sales_order:      (c[7] || '').trim() || null,
            date_entered:     (c[8] || '').trim() || new Date().toISOString().split('T')[0],
            status:           (c[9] || '').trim() || 'New/Picking',
            wo_va_notes:      (c[10] || '').trim() || null,
            order_type:       detectOpenOrderSection(part),
        });
    }
    store.openOrderAddPasteRows.value = rows;
}

// saveOpenOrderRow — validate and persist the current draft (manual or paste).
// Section is auto-detected from part # prefix in both modes.
// On success: closes modal, resets state, reloads order list.
export async function saveOpenOrderRow() {
    const mode = store.openOrderAddMode.value;

    if (mode === 'manual') {
        const form = store.openOrderAddForm.value;
        const errors = {};
        if (!form.part_number.trim()) errors.part_number = true;
        store.openOrderAddFormErrors.value = errors;
        if (Object.keys(errors).length) return;

        const part = form.part_number.trim().toUpperCase();
        const row = {
            part_number:      part,
            description:      form.description.trim()      || null,
            customer:         form.customer.trim()          || null,
            sales_order:      form.sales_order.trim()       || null,
            wo_po_number:     form.wo_po_number.trim()      || null,
            to_ship:          form.to_ship    ? Number(form.to_ship)    : null,
            qty_pulled:       form.qty_pulled ? Number(form.qty_pulled) : null,
            date_entered:     form.date_entered  || new Date().toISOString().split('T')[0],
            deadline:         form.deadline      || null,
            store_bin:        form.store_bin.trim()         || null,
            update_store_bin: form.update_store_bin.trim()  || null,
            status:           form.status || 'New/Picking',
            wo_va_notes:      form.wo_va_notes.trim()       || null,
            order_type:       detectOpenOrderSection(part),
            ...(isChutePart(part) ? { chute_status: 'New/Picking', bracket_adapter_status: 'New/Picking' } : {}),
        };

        const { error } = await db.insertOpenOrders([row]);
        if (error) { store.showToast('Failed to add row: ' + error.message); return; }

    } else {
        // paste mode — rows already have order_type set by parsePasteRows
        const rows = store.openOrderAddPasteRows.value.map(r => ({
            part_number:      r.part_number      || null,
            to_ship:          r.to_ship    ? Number(r.to_ship)    : null,
            qty_pulled:       r.qty_pulled ? Number(r.qty_pulled) : null,
            description:      r.description      || null,
            store_bin:        r.store_bin         || null,
            update_store_bin: r.update_store_bin  || null,
            customer:         r.customer          || null,
            sales_order:      r.sales_order       || null,
            date_entered:     r.date_entered      || null,
            status:           r.status            || 'New/Picking',
            wo_va_notes:      r.wo_va_notes       || null,
            order_type:       r.order_type,
        }));
        if (!rows.length) return;

        const { error } = await db.insertOpenOrders(rows);
        if (error) { store.showToast('Failed to add rows: ' + error.message); return; }
    }

    cancelAddModal();
    await loadOpenOrders();
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
