// ============================================================
// pages/purchasing-steel.js — Steel ordering tab logic
//
// Handles: inline steel field/quote editing, quote files, row
//          status picker, and the order-details confirm panel.
// Split from purchasing-view.js (500-line cap).
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { _replaceInStore } from './purchasing-receive.js';

// saveSteelField — auto-save a single text field on a steel order (blur handler).
export async function saveSteelField(orderId, field, value) {
    try {
        const { error } = await db.updatePurchasingOrder(orderId, { [field]: value || null });
        if (error) throw error;
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveSteelField', err);
    }
}

// saveSteelQuotes — save the full steel_quotes array for an order (blur handler for any quote field).
export async function saveSteelQuotes(orderId) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order) return;
    const toSave = (order.steel_quotes || [])
        .filter(q => q.supplier || q.price || q.lead_time || q.notes || q.file_path)
        .map(q => ({
            supplier:  q.supplier  || '',
            price:     q.price     || '',
            lead_time: q.lead_time || '',
            best:      q.best      || false,
            notes:     q.notes     || '',
            file_path: q.file_path || '',
            file_name: q.file_name || '',
        }));
    try {
        const { error } = await db.updatePurchasingOrder(orderId, { steel_quotes: toSave });
        if (error) throw error;
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveSteelQuotes', err);
    }
}

// addSteelQuote — append an empty quote slot to an order's inline quote list.
export function addSteelQuote(orderId) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order) return;
    if (!Array.isArray(order.steel_quotes)) order.steel_quotes = [];
    order.steel_quotes.push({ supplier: '', price: '', lead_time: '', best: false, notes: '', file_path: '', file_name: '', _uploading: false });
}

// toggleBestQuote — mark a quote as the best option; clears the flag on all others.
// Clicking the same quote again deselects it.
export function toggleBestQuote(orderId, idx) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order || !Array.isArray(order.steel_quotes)) return;
    const wasBest = order.steel_quotes[idx]?.best;
    order.steel_quotes.forEach((q, i) => { q.best = (i === idx && !wasBest); });
    saveSteelQuotes(orderId);
}

// removeSteelQuote — remove a quote slot by index and persist.
export async function removeSteelQuote(orderId, idx) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order || !Array.isArray(order.steel_quotes)) return;
    order.steel_quotes = order.steel_quotes.filter((_, i) => i !== idx);
    await saveSteelQuotes(orderId);
}

// uploadSteelQuoteFile — upload a file for a specific quote slot; stores path in steel_quotes.
export async function uploadSteelQuoteFile(orderId, idx, file) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order || !file) return;
    const quote = order.steel_quotes?.[idx];
    if (!quote) return;
    quote._uploading = true;
    try {
        const { path, error } = await db.uploadSteelQuoteAttachment(orderId, file);
        if (error) throw error;
        quote.file_path = path;
        quote.file_name = file.name;
        await saveSteelQuotes(orderId);
        store.showToast('File uploaded.', 'success');
    } catch (err) {
        store.showToast('Upload failed: ' + err.message);
        logError('uploadSteelQuoteFile', err);
    } finally {
        quote._uploading = false;
    }
}

// openSteelQuoteFile — generate a signed URL and open the quote file in a new tab.
export async function openSteelQuoteFile(filePath) {
    try {
        const { url, error } = await db.getSteelQuoteSignedUrl(filePath);
        if (error) throw error;
        window.open(url, '_blank');
    } catch (err) {
        store.showToast('Could not open file: ' + err.message);
        logError('openSteelQuoteFile', err);
    }
}

// removeSteelQuoteFile — delete the file from storage and clear the path on the quote slot.
export async function removeSteelQuoteFile(orderId, idx) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order) return;
    const quote = order.steel_quotes?.[idx];
    if (!quote?.file_path) return;
    try {
        const { error } = await db.deleteOrderAttachment(quote.file_path);
        if (error) throw error;
    } catch (err) {
        logError('removeSteelQuoteFile', err); // non-fatal; clear locally anyway
    }
    quote.file_path = '';
    quote.file_name = '';
    await saveSteelQuotes(orderId);
}

// toggleSteelStatusPicker — open/close the inline status picker for a steel row.
export function toggleSteelStatusPicker(orderId) {
    store.steelStatusPickerOpen.value =
        store.steelStatusPickerOpen.value === orderId ? null : orderId;
}

// setSteelStatus — save a new status for a steel order directly from the row badge.
// Selecting 'ordered' opens the order details panel instead of saving immediately.
export async function setSteelStatus(orderId, newStatus) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order || order.status === newStatus) {
        store.steelStatusPickerOpen.value = null;
        return;
    }

    if (newStatus === 'ordered') {
        store.steelStatusPickerOpen.value = null;
        const best = (order.steel_quotes || []).find(q => q.best)
                  || (order.steel_quotes || []).find(q => q.supplier);
        const todayStr = new Date().toISOString().split('T')[0];
        store.steelOrderForm.value = {
            supplier_name:       best?.supplier              || order.supplier_name        || '',
            po_number:           order.po_number             || '',
            date_ordered:        order.date_ordered          || todayStr,
            cost:                best?.price                 || (order.cost        != null ? String(order.cost)                 : ''),
            qty_ordered:         order.qty_ordered != null   ? String(order.qty_ordered)   : (order.qty_needed != null ? String(order.qty_needed) : ''),
            estimated_lead_time: best?.lead_time             || (order.estimated_lead_time != null ? String(order.estimated_lead_time) : ''),
        };
        store.steelOrderErrors.value   = {};
        store.steelOrderPanelOpen.value = orderId;
        return;
    }

    const oldStatus = order.status;
    try {
        const { data, error } = await db.updatePurchasingOrder(orderId, {
            status: newStatus,
            last_status_update: new Date().toISOString(),
        });
        if (error) throw error;
        _replaceInStore(data);
        db.insertPurchasingEvent({
            orderId, eventType: 'status_change',
            oldStatus, newStatus, createdBy: 'purchasing',
        });
        store.showToast('Status updated.', 'success');
    } catch (err) {
        store.showToast('Failed to update status: ' + err.message);
        logError('setSteelStatus', err);
    } finally {
        store.steelStatusPickerOpen.value = null;
    }
}

// selectSteelQuoteForOrder — pre-fill the order panel form from a quote card.
export function selectSteelQuoteForOrder(orderId, idx) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order || !Array.isArray(order.steel_quotes)) return;
    const q = order.steel_quotes[idx];
    if (!q) return;
    store.steelOrderForm.value = {
        ...store.steelOrderForm.value,
        supplier_name:       q.supplier  || store.steelOrderForm.value.supplier_name,
        cost:                q.price     || store.steelOrderForm.value.cost,
        estimated_lead_time: q.lead_time || store.steelOrderForm.value.estimated_lead_time,
    };
}

// closeSteelOrderPanel — dismiss the order details panel without saving.
export function closeSteelOrderPanel() {
    store.steelOrderPanelOpen.value = null;
}

// confirmSteelOrder — validate the order panel form and save status=ordered + details.
export async function confirmSteelOrder(orderId) {
    const order = store.purchasingOrders.value.find(o => o.id === orderId);
    if (!order) return;
    const form   = store.steelOrderForm.value;
    const errors = {};
    if (!form.supplier_name?.trim())    errors.supplier_name       = true;
    if (!form.po_number?.trim())        errors.po_number           = true;
    if (!form.cost)                     errors.cost                = true;
    if (!form.qty_ordered)              errors.qty_ordered         = true;
    if (!form.estimated_lead_time)      errors.estimated_lead_time = true;
    store.steelOrderErrors.value = errors;
    if (Object.keys(errors).length > 0) return;

    store.steelOrderSaving.value = true;
    try {
        const leadDays = parseFloat(form.estimated_lead_time) || null;
        const updates  = {
            status:               'ordered',
            supplier_name:        form.supplier_name.trim(),
            po_number:            form.po_number.trim(),
            date_ordered:         form.date_ordered          || null,
            cost:                 parseFloat(form.cost)     || null,
            qty_ordered:          parseFloat(form.qty_ordered) || null,
            estimated_lead_time:  leadDays,
            last_status_update:   new Date().toISOString(),
        };
        if (leadDays && order.date_requested) {
            const d = new Date(order.date_requested);
            d.setDate(d.getDate() + leadDays);
            updates.expected_date = d.toISOString().split('T')[0];
        }
        const { data, error } = await db.updatePurchasingOrder(orderId, updates);
        if (error) throw error;
        _replaceInStore(data);
        db.insertPurchasingEvent({
            orderId, eventType: 'status_change',
            oldStatus: order.status, newStatus: 'ordered', createdBy: 'purchasing',
        });
        store.showToast('Order confirmed.', 'success');
        store.steelOrderPanelOpen.value = null;
    } catch (err) {
        store.showToast('Failed to confirm order: ' + err.message);
        logError('confirmSteelOrder', err);
    } finally {
        store.steelOrderSaving.value = false;
    }
}
