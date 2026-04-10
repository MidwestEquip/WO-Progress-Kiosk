// ============================================================
// pages/open-orders-view.js — Open Orders (Shipping) view logic
//
// Handles: loading orders, per-section sort, row color changes,
//          Add Row modal (manual + paste), inline cell save.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { OPEN_ORDER_STATUSES } from '../libs/config.js';

// loadOpenOrders — fetch all open_orders rows into store.
export async function loadOpenOrders() {
    store.openOrdersLoading.value = true;
    try {
        const { data, error } = await db.fetchOpenOrders();
        if (error) throw error;
        store.openOrders.value = data || [];
    } catch (err) {
        store.showToast('Failed to load open orders: ' + err.message);
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

// openOrderRowClass — Tailwind classes for row bg + left border based on row_color.
export function openOrderRowClass(color) {
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

// openOrderHasLine3 — true if this row has any line-3 data to display.
export function openOrderHasLine3(order) {
    return !!(
        order.box1 || order.box2 || order.box3 || order.box4 ||
        order.dims || order.weight_lbs ||
        order.ship_quote_1 || order.ship_quote_2 ||
        order.ship_cost_3  || order.ship_paid_4  ||
        order.chute_status || order.bracket_adapter_status ||
        order.holding_bin_chute || order.holding_bin_status ||
        order.holding_bin_part  || order.override
    );
}
