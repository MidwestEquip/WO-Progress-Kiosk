// ============================================================
// pages/planning-production-load.js — Production Load view: live
// work_orders grouped by department × week of due_date. Read-mostly
// (plus inline due-date reschedule). Imports store/db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadProductionLoad — pull every active work order for the load view.
export async function loadProductionLoad() {
    store.prodLoadLoading.value = true;
    try {
        const { data, error } = await db.fetchActiveWorkOrders();
        if (error) throw error;
        store.prodLoadRows.value = data;
    } catch (err) {
        store.showToast('Failed to load production load: ' + err.message);
        logError('loadProductionLoad', err);
    } finally {
        store.prodLoadLoading.value = false;
    }
}

// rescheduleWorkOrder — move one WO department-slice up/back by editing its due
// date; updates the row in place so it re-buckets into the right week.
export async function rescheduleWorkOrder(row, dueDate) {
    try {
        const { data, error } = await db.updateWorkOrderDueDate(row.id, dueDate || null);
        if (error) throw error;
        Object.assign(row, data);
    } catch (err) {
        store.showToast('Reschedule failed: ' + err.message);
        logError('rescheduleWorkOrder', err, { id: row.id });
    }
}
