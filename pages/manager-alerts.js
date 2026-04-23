// ============================================================
// pages/manager-alerts.js — Alert resolve modal handlers
//
// openAlertResolve(order, alertType): open the resolve modal
// submitAlertResolve(): validate + persist + dismiss
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { loadManagerAlerts } from './manager-view.js';

// alertType → reference_id field on the order object
// stale_order uses the open_orders id; all others use wo_number
function refIdFor(order, alertType) {
    return alertType === 'stale_order' ? String(order.id) : String(order.wo_number);
}

// openAlertResolve — open the resolve modal for a specific alert card row
export function openAlertResolve(order, alertType) {
    store.alertResolveTarget.value    = order;
    store.alertResolveType.value      = alertType;
    store.alertResolveBy.value        = '';
    store.alertResolveText.value      = '';
    store.alertResolveByError.value   = false;
    store.alertResolveTextError.value = false;
    store.alertResolveOpen.value      = true;
}

// submitAlertResolve — validate, persist, dismiss, and refresh alerts
export async function submitAlertResolve() {
    const byVal   = store.alertResolveBy.value.trim();
    const textVal = store.alertResolveText.value.trim();

    store.alertResolveByError.value   = !byVal;
    store.alertResolveTextError.value = !textVal;
    if (!byVal || !textVal) return;

    store.loading.value = true;
    try {
        const order     = store.alertResolveTarget.value;
        const alertType = store.alertResolveType.value;
        const refId     = refIdFor(order, alertType);

        const { error } = await db.insertAlertResolution(alertType, refId, byVal, textVal);
        if (error) throw error;

        store.alertResolveOpen.value = false;
        await loadManagerAlerts();
    } catch (err) {
        store.showToast('Failed to save resolution: ' + err.message);
        logError('submitAlertResolve', err);
    } finally {
        store.loading.value = false;
    }
}
