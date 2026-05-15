// ============================================================
// pages/create-wo-view.js — Create WO queue logic
//
// Shows in-production requests pending an official WO#.
// Once the Alere/ERP WO# is known, operator enters it and clicks
// Set WO# — saves to wo_requests.alere_wo_number only.
// Imports from store + db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// switchCreateWoTab — change active tab and load data for the selected tab.
export async function switchCreateWoTab(tab) {
    store.createWoTab.value = tab;
    if (tab === 'created') await loadCreatedWoItems();
}

// loadCreatedWoItems — fetch all requests that have an official alere_wo_number (Created tab).
export async function loadCreatedWoItems() {
    store.createWoLoading.value = true;
    try {
        const { data, error } = await db.fetchCreatedWoRequests();
        if (error) throw error;
        store.createdWoItems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load created WOs: ' + err.message);
        logError('loadCreatedWoItems', err);
        store.createdWoItems.value = [];
    } finally {
        store.createWoLoading.value = false;
    }
}

// loadCreateWoItems — fetch in-production requests pending an official WO# (To Create tab).
export async function loadCreateWoItems() {
    store.createWoTab.value     = 'pending';
    store.createWoLoading.value = true;
    try {
        const { data, error } = await db.fetchApprovedWoRequests();
        if (error) throw error;
        const items = data || [];
        store.createWoItems.value = items;
        // Initialize inline WO# input state, preserving any in-progress input
        const prev  = store.createWoInlineState.value;
        const state = {};
        items.forEach(item => {
            state[item.id] = { wo_number: prev[item.id]?.wo_number || '' };
        });
        store.createWoInlineState.value = state;
    } catch (err) {
        store.showToast('Failed to load pending WOs: ' + err.message);
        logError('loadCreateWoItems', err);
        store.createWoItems.value = [];
    } finally {
        store.createWoLoading.value = false;
    }
}

// setAlereWoNumber — attach the official Alere/ERP WO# to an in-production request.
// Validates uniqueness, saves to wo_requests.alere_wo_number, then reloads the list.
export async function setAlereWoNumber(id) {
    const state = store.createWoInlineState.value[id];
    if (!state) return;
    const woNumber = (state.wo_number || '').trim().toUpperCase();
    if (!woNumber) { store.showToast('Enter a WO # before saving.', 'error'); return; }

    const isDupe = await db.checkWoNumberExists(woNumber);
    if (isDupe) {
        store.showToast(`WO# ${woNumber} already exists in the system.`, 'error');
        return;
    }

    store.loading.value = true;
    try {
        const { error } = await db.updateAlereWoNumber(id, woNumber);
        if (error) throw error;

        const req = store.createWoItems.value.find(r => r.id === id);

        // Update work_orders.wo_number and backfill wo_status_tracking with the real WO#
        if (req?.job_number) {
            const [{ error: woErr }, { error: trackErr }] = await Promise.all([
                db.updateWorkOrdersWoNumberByJobNumber(req.job_number, woNumber),
                db.updateTrackingWoNumberByJobNumber(req.job_number, woNumber),
            ]);
            if (woErr)    logError('setAlereWoNumber:updateWorkOrders', woErr,    { job_number: req.job_number, woNumber });
            if (trackErr) logError('setAlereWoNumber:updateTracking',   trackErr, { job_number: req.job_number, woNumber });
        }

        // Sync WO# + status → 'WO Created' on matching open order if applicable
        const soNum = (req?.sales_order_number || '').trim();
        const part  = (req?.part_number        || '').trim().toUpperCase();
        if (soNum && part) {
            const { data: oo } = await db.findOpenOrderBySoAndPart(soNum, part);
            if (oo) {
                await db.updateOpenOrder(oo.id, { wo_po_number: woNumber, status: 'WO Created', last_status_update: new Date().toISOString() });
            }
        }

        store.showToast(`WO# ${woNumber} saved.`, 'success');
        await loadCreateWoItems();
    } catch (err) {
        store.showToast('Failed to save WO#: ' + err.message, 'error');
        logError('setAlereWoNumber', err, { id });
    } finally {
        store.loading.value = false;
    }
}
