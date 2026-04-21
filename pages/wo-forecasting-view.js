// ============================================================
// pages/wo-forecasting-view.js — WO Forecasting screen logic
//
// Handles: loading forecasted requests, deleting items, moving
// items back to the WO Request sheet.
// Imports from store + db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadForecastedItems — fetch all wo_requests where forecasted=true.
export async function loadForecastedItems() {
    store.forecastingLoading.value = true;
    try {
        const { data, error } = await db.fetchForecastedRequests();
        if (error) throw error;
        store.forecastingItems.value = data || [];
    } catch (err) {
        store.showToast('Failed to load forecasting data: ' + err.message);
        logError('loadForecastedItems', err);
        store.forecastingItems.value = [];
    } finally {
        store.forecastingLoading.value = false;
    }
}

// openDeleteConfirm — open the delete confirmation modal for a given item ID.
export function openDeleteConfirm(id) {
    store.forecastDeleteId.value = id;
}

// cancelDeleteForecast — dismiss the delete confirmation modal.
export function cancelDeleteForecast() {
    store.forecastDeleteId.value = null;
}

// confirmDeleteForecast — permanently delete the wo_request row.
export async function confirmDeleteForecast() {
    const id = store.forecastDeleteId.value;
    if (!id) return;
    store.forecastDeleteId.value = null;
    store.loading.value = true;
    try {
        const { error } = await db.deleteWoRequest(id);
        if (error) throw error;
        store.showToast('WO Request deleted.', 'success');
        await loadForecastedItems();
    } catch (err) {
        store.showToast('Failed to delete: ' + err.message, 'error');
        logError('confirmDeleteForecast', err, { id });
    } finally {
        store.loading.value = false;
    }
}

// openMoveBackConfirm — open the move-back confirmation modal for a given item ID.
export function openMoveBackConfirm(id) {
    store.forecastMoveBackId.value = id;
}

// cancelMoveBack — dismiss the move-back confirmation modal.
export function cancelMoveBack() {
    store.forecastMoveBackId.value = null;
}

// confirmMoveBack — clear forecasting flags and reset request_date to today.
export async function confirmMoveBack() {
    const id = store.forecastMoveBackId.value;
    if (!id) return;
    store.forecastMoveBackId.value = null;
    store.loading.value = true;
    try {
        const today = new Date().toISOString().slice(0, 10);
        const { error } = await db.updateWoRequest(id, {
            forecasted:      false,
            forecast_date:   null,
            forecast_reason: null,
            request_date:    today,
        });
        if (error) throw error;
        store.showToast('Moved back to WO Request sheet.', 'success');
        await loadForecastedItems();
    } catch (err) {
        store.showToast('Failed to move back: ' + err.message, 'error');
        logError('confirmMoveBack', err, { id });
    } finally {
        store.loading.value = false;
    }
}
