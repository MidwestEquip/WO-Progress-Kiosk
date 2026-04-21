// ============================================================
// pages/wo-forecasting-view.js — WO Forecasting screen logic
//
// Handles: loading forecasted requests, removing items from forecast.
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

// removeForecastItem — clear forecasting flags, returning item to the request list.
export async function removeForecastItem(id) {
    if (!confirm('Remove this item from WO Forecasting? It will return to the request list.')) return;
    store.loading.value = true;
    try {
        const { error } = await db.updateWoRequest(id, {
            forecasted:      false,
            forecast_date:   null,
            forecast_reason: null,
        });
        if (error) throw error;
        store.showToast('Removed from forecasting.', 'success');
        await loadForecastedItems();
    } catch (err) {
        store.showToast('Failed to remove: ' + err.message, 'error');
        logError('removeForecastItem', err, { id });
    } finally {
        store.loading.value = false;
    }
}
