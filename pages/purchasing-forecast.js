// ============================================================
// pages/purchasing-forecast.js — PO Forecasting business logic
//
// Handles: enter/exit view, load list, delete, move-back-to-ordering,
//          and submitting a new request directly as forecasted.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { APP_LOCATION } from '../libs/config.js';

// enterPoForecastingView — navigate to the PO Forecasting standalone view.
export function enterPoForecastingView() {
    store.currentView.value = 'po_forecasting';
}

// exitPoForecastingView — navigate back to the splash screen.
export function exitPoForecastingView() {
    store.currentView.value = 'splash';
}

// loadPoForecast — fetch all forecasted purchasing orders into store.
export async function loadPoForecast() {
    store.poForecastLoading.value = true;
    try {
        const { data, error } = await db.fetchForecastedOrders();
        if (error) throw error;
        store.poForecastOrders.value = data;
    } catch (err) {
        store.showToast('Failed to load forecasted orders: ' + err.message);
        logError('loadPoForecast', err);
    } finally {
        store.poForecastLoading.value = false;
    }
}

// openPoForecastDeleteConfirm — open the delete confirmation for an order.
export function openPoForecastDeleteConfirm(orderId) {
    store.poForecastDeleteId.value = orderId;
}

// cancelPoForecastDelete — dismiss the delete confirmation without action.
export function cancelPoForecastDelete() {
    store.poForecastDeleteId.value = null;
}

// confirmPoForecastDelete — permanently delete a forecasted order.
export async function confirmPoForecastDelete() {
    const id = store.poForecastDeleteId.value;
    if (!id) return;
    store.poForecastLoading.value = true;
    try {
        const { error } = await db.deletePurchasingOrder(id);
        if (error) throw error;
        store.poForecastOrders.value = store.poForecastOrders.value.filter(o => o.id !== id);
        store.showToast('Order removed.', 'success');
    } catch (err) {
        store.showToast('Failed to delete order: ' + err.message);
        logError('confirmPoForecastDelete', err);
    } finally {
        store.poForecastLoading.value = false;
        store.poForecastDeleteId.value = null;
    }
}

// openPoForecastMoveBack — open the move-back confirmation for an order.
export function openPoForecastMoveBack(orderId) {
    store.poForecastMoveBackId.value = orderId;
}

// cancelPoForecastMoveBack — dismiss the move-back confirmation without action.
export function cancelPoForecastMoveBack() {
    store.poForecastMoveBackId.value = null;
}

// confirmPoForecastMoveBack — set forecasted=false; order returns to the active ordering tabs.
export async function confirmPoForecastMoveBack() {
    const id = store.poForecastMoveBackId.value;
    if (!id) return;
    store.poForecastLoading.value = true;
    try {
        const { error } = await db.updatePurchasingOrder(id, { forecasted: false });
        if (error) throw error;
        store.poForecastOrders.value = store.poForecastOrders.value.filter(o => o.id !== id);
        store.showToast('Moved to active ordering.', 'success');
    } catch (err) {
        store.showToast('Failed to move order: ' + err.message);
        logError('confirmPoForecastMoveBack', err);
    } finally {
        store.poForecastLoading.value = false;
        store.poForecastMoveBackId.value = null;
    }
}

// openForecastOrderDetail — open the purchasing detail modal for a forecasted order.
// Populates the ordering form from the order object so all tabs render correctly.
// Status select is disabled via purchasingDetailOrder.forecasted === true.
export function openForecastOrderDetail(order) {
    store.purchasingDetailOrder.value  = order;
    store.purchasingDetailSection.value = 'ordering';
    store.purchasingDetailSaving.value  = false;
    store.purchasingDetailAutoSaved.value = false;
    store.purchasingDetailForm.value = {
        status:               order.status               || 'requested',
        ship_to:              order.ship_to              || APP_LOCATION,
        supplier_name:        order.supplier_name        || '',
        supplier_part_number: order.supplier_part_number || '',
        po_number:            order.po_number            || '',
        date_ordered:         order.date_ordered         || '',
        estimated_lead_time:  order.estimated_lead_time  || '',
        expected_date:        order.expected_date        || '',
        qty_ordered:          order.qty_ordered != null  ? String(order.qty_ordered) : '',
        cost:                 order.cost        != null  ? String(order.cost)        : '',
        purchaser_notes:      order.purchaser_notes      || '',
        purchaser_questions:  order.purchaser_questions  || '',
        production_notes:     order.production_notes     || '',
    };
    store.purchasingDetailEvents.value        = [];
    store.purchasingDetailEventsLoading.value = false;
    store.purchasingDetailOpen.value          = true;
}

// checkForecastRevisits — called on purchasing/po_forecasting view entry.
// Finds forecasted orders whose revisit date has arrived, moves them back to
// ordering, and appends a note to purchaser_notes explaining why they returned.
export async function checkForecastRevisits() {
    const today = new Date().toISOString().slice(0, 10);
    try {
        const { data, error } = await db.fetchForecastedOrders();
        if (error) throw error;
        const due = (data || []).filter(o => o.forecast_revisit_date && o.forecast_revisit_date <= today);
        if (due.length === 0) return;
        await Promise.all(due.map(o => {
            const note = `Forecast revisit ${o.forecast_revisit_date}: ${(o.forecast_reason || '').trim()}`.trimEnd();
            const existing = o.purchaser_notes?.trim() || '';
            const purchaser_notes = existing ? `${existing}\n${note}` : note;
            return db.updatePurchasingOrder(o.id, { forecasted: false, purchaser_notes });
        }));
        const count = due.length;
        store.showToast(`${count} forecasted order${count !== 1 ? 's' : ''} returned to ordering.`, 'success');
    } catch (err) {
        logError('checkForecastRevisits', err);
    }
}

// openPoForecastSend — open the "Send to Forecast" confirmation dialog for the
// currently open order detail. Called from the detail modal footer.
export function openPoForecastSend() {
    store.poForecastSendForm.value   = { revisit_date: '', reason: '' };
    store.poForecastSendErrors.value = {};
    store.poForecastSendOpen.value   = true;
}

// closePoForecastSend — dismiss the confirmation without saving.
export function closePoForecastSend() {
    store.poForecastSendOpen.value = false;
}

// submitPoForecastSend — mark the current order as forecasted with revisit date + reason,
// remove it from the active ordering list, and close both modals.
export async function submitPoForecastSend() {
    const form = store.poForecastSendForm.value;
    const errors = {};
    if (!form.revisit_date)   errors.revisit_date = true;
    if (!form.reason?.trim()) errors.reason       = true;
    store.poForecastSendErrors.value = errors;
    if (Object.keys(errors).length > 0) return;

    const order = store.purchasingDetailOrder.value;
    if (!order) return;

    store.poForecastSendSaving.value = true;
    try {
        const { error } = await db.updatePurchasingOrder(order.id, {
            forecasted:            true,
            forecast_revisit_date: form.revisit_date,
            forecast_reason:       form.reason.trim(),
            ship_to:               store.purchasingDetailForm.value.ship_to?.trim() || null,
        });
        if (error) throw error;
        store.purchasingOrders.value     = store.purchasingOrders.value.filter(o => o.id !== order.id);
        store.purchasingDetailOpen.value = false;
        store.poForecastSendOpen.value   = false;
        store.showToast('Sent to PO Forecast.', 'success');
    } catch (err) {
        store.showToast('Failed to send to forecast: ' + err.message);
        logError('submitPoForecastSend', err);
    } finally {
        store.poForecastSendSaving.value = false;
    }
}
