// ============================================================
// pages/purchasing-view.js — Purchasing section business logic
//
// Handles: data loading, tab switching, new request form,
//          detail/edit modal, status changes, receiving.
// ============================================================

import { watch } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { APP_LOCATION, PURCHASING_3YR_START } from '../libs/config.js';
import { _replaceInStore } from './purchasing-receive.js';

// ── Autosave machinery ────────────────────────────────────────
let _autosaveTimer = null;
let _formSnapshot  = null; // JSON snapshot of form at last open/save

function _scheduleAutosave() {
    if (!store.purchasingDetailOpen.value) return;
    // Skip if form hasn't changed since it was last loaded or saved
    if (_formSnapshot !== null &&
        JSON.stringify(store.purchasingDetailForm.value) === _formSnapshot) return;
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(_doSave, 800);
}

watch(store.purchasingDetailForm, _scheduleAutosave, { deep: true });

const BLANK_FORM = () => ({
    request_type:              '',
    requested_by:              '',
    needed_by:                 '',
    qty_needed:                '',
    requester_notes:           '',
    part_number:               '',
    description:               '',
    sales_order:               '',
    estimated_qty_in_stock:    '',
    request_location:          '',
    bin_location:              '',
    current_production_run:    '',
    supply_item_name:          '',
    supply_category:           '',
    // Steel-specific fields
    material_type:             'Carbon',  // dropdown: Carbon/Stainless/Galvanized/Aluminum/Other
    steel_shape:               '',
    material_description:      '',  // free text: size, grade, finish combined
    material_length:           '',
});

// normalizeSteelQuotes — ensures steel orders always have at least 5 quote slots with all fields.
function normalizeSteelQuotes(orders) {
    orders.forEach(o => {
        if (o.request_type !== 'steel') return;
        const q = Array.isArray(o.steel_quotes) ? o.steel_quotes : [];
        while (q.length < 5) q.push({ supplier: '', price: '', lead_time: '', best: false, notes: '', file_path: '', file_name: '' });
        q.forEach(slot => {
            if (slot.notes     === undefined) slot.notes     = '';
            if (slot.file_path === undefined) slot.file_path = '';
            if (slot.file_name === undefined) slot.file_name = '';
            slot._uploading = false;
        });
        o.steel_quotes = q;
    });
}

// loadPurchasingOrders — fetch all active purchasing orders into store.
export async function loadPurchasingOrders() {
    store.purchasingLoading.value = true;
    try {
        const { data, error } = await db.fetchPurchasingOrders();
        if (error) throw error;
        normalizeSteelQuotes(data);
        store.purchasingOrders.value = data;
    } catch (err) {
        store.showToast('Failed to load purchasing orders: ' + err.message);
        logError('loadPurchasingOrders', err);
    } finally {
        store.purchasingLoading.value = false;
    }
}

// switchPurchasingTab — change the active ordering tab; auto-loads completed.
export function switchPurchasingTab(tab) {
    if (tab !== 'approval') {
        store.approvalManagerAuthed.value = false;
        store.approvalPinInput.value      = '';
        store.approvalPinError.value      = false;
        store.approvalReviseOpen.value    = false;
        store.approvalReviseNote.value    = '';
    }
    store.purchasingTab.value = tab;
    if (tab === 'completed') loadPurchasingCompleted();
}

// loadPurchasingCompleted — fetch received/canceled orders with optional date range.
export async function loadPurchasingCompleted() {
    store.purchasingCompletedLoading.value = true;
    try {
        const { data, error } = await db.fetchCompletedPurchasingOrders(
            store.purchasingCompletedFrom.value || undefined,
            store.purchasingCompletedTo.value   || undefined,
        );
        if (error) throw error;
        store.purchasingCompletedOrders.value = data;
    } catch (err) {
        store.showToast('Failed to load completed orders: ' + err.message);
        logError('loadPurchasingCompleted', err);
    } finally {
        store.purchasingCompletedLoading.value = false;
    }
}

// ── New request form ──────────────────────────────────────────

// onPurchasingPartBlur — on blur of Part # in the new PO request form (Part type only),
// auto-fills description from issues_receipts if the description field is currently blank.
export async function onPurchasingPartBlur() {
    const form = store.purchasingRequestForm.value;
    const part = (form.part_number || '').trim().toUpperCase();
    if (!part || form.description) return;
    const { data: desc } = await db.fetchPartDescription(part);
    if (desc) store.purchasingRequestForm.value = { ...form, description: desc };
}

// openNewRequestForm — reset form and open the create request modal.
export function openNewRequestForm() {
    store.purchasingRequestForm.value       = BLANK_FORM();
    store.purchasingRequestFormErrors.value = {};
    store.purchasingRequestModalOpen.value  = true;
}

// closeNewRequestForm — close the modal without saving.
export function closeNewRequestForm() {
    store.purchasingRequestModalOpen.value = false;
}

// submitPurchasingRequest — validate, insert, prepend to store, reset form.
export async function submitPurchasingRequest() {
    const form   = store.purchasingRequestForm.value;
    const errors = {};

    if (!form.request_type)         errors.request_type      = true;
    if (!form.requested_by?.trim()) errors.requested_by      = true;

    if (form.request_type === 'part') {
        if (!form.part_number?.trim())    errors.part_number    = true;
        if (!form.description?.trim())    errors.description    = true;
        if (!form.request_location?.trim()) errors.request_location = true;
    }
    if (form.request_type === 'supply' && !form.supply_item_name?.trim()) {
        errors.supply_item_name = true;
    }
    if (form.request_type === 'steel') {
        if (!form.material_type)                    errors.material_type         = true;
        if (!form.steel_shape)                      errors.steel_shape           = true;
        if (!form.material_description?.trim())     errors.material_description  = true;
    }

    store.purchasingRequestFormErrors.value = errors;
    if (Object.keys(errors).length > 0) return;

    store.purchasingRequestSaving.value = true;
    try {
        const fields = {
            request_type:    form.request_type,
            requested_by:    form.requested_by.trim(),
            needed_by:       form.needed_by   || null,
            qty_needed:      parseFloat(form.qty_needed) || null,
            requester_notes: form.requester_notes?.trim() || null,
            ship_to:         APP_LOCATION,
        };

        if (form.request_type === 'part') {
            fields.part_number              = form.part_number.trim().toUpperCase();
            fields.description              = form.description.trim();
            fields.sales_order              = form.sales_order?.trim()                 || null;
            fields.estimated_qty_in_stock   = parseFloat(form.estimated_qty_in_stock) || null;
            fields.request_location         = form.request_location.trim();
            fields.bin_location             = form.bin_location?.trim()                || null;
            fields.current_production_run   = form.current_production_run?.trim()      || null;
        } else if (form.request_type === 'supply') {
            fields.supply_item_name = form.supply_item_name.trim();
            fields.supply_category  = form.supply_category?.trim()  || null;
            fields.description      = form.description?.trim()      || null;
            fields.request_location = form.request_location?.trim() || null;
        } else if (form.request_type === 'steel') {
            fields.material_type          = form.material_type;
            fields.steel_shape            = form.steel_shape            || null;
            fields.description            = form.material_description?.trim() || null;
            fields.material_length        = form.material_length?.trim()       || null;
            fields.current_production_run = form.current_production_run?.trim() || null;
        }

        const { data, error } = await db.insertPurchasingOrder(fields);
        if (error) throw error;

        store.purchasingOrders.value        = [data, ...store.purchasingOrders.value];
        store.purchasingRequestForm.value   = BLANK_FORM();
        store.purchasingRequestFormErrors.value = {};
        store.showToast('Request submitted.', 'success');
    } catch (err) {
        store.showToast('Failed to submit request: ' + err.message);
        logError('submitPurchasingRequest', err);
    } finally {
        store.purchasingRequestSaving.value = false;
    }
}

// ── Steel inline editing ──────────────────────────────────────

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

// ── Detail / edit modal ───────────────────────────────────────

// loadOrderEvents — fetch history events for the currently open order.
export async function loadOrderEvents() {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    store.purchasingDetailEventsLoading.value = true;
    try {
        const { data, error } = await db.fetchPurchasingEvents(order.id);
        if (error) throw error;
        store.purchasingDetailEvents.value = data;
    } catch (err) {
        store.showToast('Failed to load history: ' + err.message);
        logError('loadOrderEvents', err);
    } finally {
        store.purchasingDetailEventsLoading.value = false;
    }
}

// openOrderDetail — load order into detail form and open modal.
// section controls which tab is shown first ('ordering'|'receiving'|'request').
export function openOrderDetail(order, section = 'ordering') {
    store.purchasingDetailEvents.value                = [];
    store.orderAttachments.value          = [];
    store.orderAttachmentsLoading.value   = false;
    store.orderAttachmentsUploading.value = false;
    store.purchasingPartUsage.value                   = null;
    store.purchasingPartParentUsage.value             = null;
    store.purchasingPartUsageLoading.value            = false;
    store.purchasingPartParentUsageLoading.value      = false;
    store.purchasingPartPurchaseHistory.value         = [];
    store.purchasingPartPurchaseHistoryLoading.value  = false;
    store.purchasingPartPurchaseHistoryError.value    = false;
    // Reset supplier catalog so stale data doesn't carry over between orders
    store.supplierCatalogLoading.value = false;
    store.supplierCatalogParts.value   = [];
    store.supplierCatalogCoid.value    = null;
    store.supplierCatalogName.value    = '';
    store.supplierCatalogSearch.value  = '';
    store.supplierCatalogChoices.value = [];
    store.purchasingDetailOrder.value   = order;
    store.purchasingDetailSection.value = section;
    const today = new Date().toISOString().split('T')[0];
    store.purchasingDetailForm.value = {
        status:               order.status               || 'requested',
        ship_to:              order.ship_to              || APP_LOCATION,
        supplier_name:        order.supplier_name        || '',
        supplier_part_number: order.supplier_part_number || '',
        po_number:            order.po_number            || '',
        date_ordered:         order.date_ordered         || today,
        estimated_lead_time:  order.estimated_lead_time  ?? '',
        expected_date:        order.expected_date        || '',
        qty_ordered:          order.qty_ordered          ?? '',
        cost:                 order.cost                 ?? '',
        purchaser_notes:      order.purchaser_notes      || '',
        purchaser_questions:  order.purchaser_questions  || '',
        production_notes:     order.production_notes     || '',
    };
    store.purchasingReceiveForm.value = {
        qty_received: order.qty_received ?? '',
        received_by:  order.received_by  || '',
    };
    store.purchasingDetailOpen.value = true;
    // Snapshot after setting so the watcher doesn't trigger an immediate save
    _formSnapshot = JSON.stringify(store.purchasingDetailForm.value);
}

// closeOrderDetail — dismiss the detail modal.
export function closeOrderDetail() {
    store.purchasingDetailOpen.value = false;
}

// syncDetailFromRealtime — called by the realtime handler when a purchasing_orders UPDATE
// arrives. Refreshes the open modal form without triggering autosave. No-op if modal is
// closed or a different order is open.
export function syncDetailFromRealtime(row) {
    if (!store.purchasingDetailOpen.value) return;
    if (!store.purchasingDetailOrder.value || store.purchasingDetailOrder.value.id !== row.id) return;
    store.purchasingDetailOrder.value = row;
    store.purchasingDetailForm.value = {
        status:               row.status               || 'requested',
        ship_to:              row.ship_to              || APP_LOCATION,
        supplier_name:        row.supplier_name        || '',
        supplier_part_number: row.supplier_part_number || '',
        po_number:            row.po_number            || '',
        date_ordered:         row.date_ordered         || '',
        estimated_lead_time:  row.estimated_lead_time  ?? '',
        expected_date:        row.expected_date        || '',
        qty_ordered:          row.qty_ordered          ?? '',
        cost:                 row.cost                 ?? '',
        purchaser_notes:      row.purchaser_notes      || '',
        purchaser_questions:  row.purchaser_questions  || '',
        production_notes:     row.production_notes     || '',
    };
    _formSnapshot = JSON.stringify(store.purchasingDetailForm.value);
}

// _doSave — internal save: persists ordering fields, updates snapshot, no modal close.
async function _doSave() {
    const order = store.purchasingDetailOrder.value;
    const form  = store.purchasingDetailForm.value;
    if (!order) return;

    const updates = {
        status:               form.status,
        ship_to:              form.ship_to?.trim()                 || null,
        supplier_name:        form.supplier_name?.trim()           || null,
        supplier_part_number: form.supplier_part_number?.trim()    || null,
        po_number:            form.po_number?.trim()               || null,
        date_ordered:         form.date_ordered                    || null,
        estimated_lead_time:  parseFloat(form.estimated_lead_time) || null,
        expected_date:        form.expected_date                   || null,
        qty_ordered:          parseFloat(form.qty_ordered)         || null,
        cost:                 parseFloat(form.cost)                || null,
        purchaser_notes:      form.purchaser_notes?.trim()         || null,
        purchaser_questions:  form.purchaser_questions?.trim()     || null,
        production_notes:     form.production_notes?.trim()        || null,
    };

    if (form.estimated_lead_time && !form.expected_date && order.date_requested) {
        const d = new Date(order.date_requested);
        d.setDate(d.getDate() + parseFloat(form.estimated_lead_time));
        updates.expected_date = d.toISOString().split('T')[0];
    }

    const statusChanged = form.status !== order.status;
    if (statusChanged) updates.last_status_update = new Date().toISOString();

    store.purchasingDetailSaving.value = true;
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, updates);
        if (error) throw error;

        _replaceInStore(data);
        store.purchasingDetailOrder.value  = data;
        _formSnapshot = JSON.stringify(store.purchasingDetailForm.value);
        store.purchasingDetailAutoSaved.value = true;
        setTimeout(() => { store.purchasingDetailAutoSaved.value = false; }, 2000);

        if (statusChanged) {
            db.insertPurchasingEvent({
                orderId:   order.id,
                eventType: 'status_change',
                oldStatus: order.status,
                newStatus: form.status,
                createdBy: 'purchasing',
            });
        }
    } catch (err) {
        store.showToast('Failed to save order: ' + err.message);
        logError('_doSave', err);
    } finally {
        store.purchasingDetailSaving.value = false;
    }
}

// saveOrderDetail — exported for any explicit callers; delegates to _doSave.
export async function saveOrderDetail() {
    await _doSave();
}

export { completeOrder, submitReceiving, _replaceInStore } from './purchasing-receive.js';
export { enterApprovalTab, approveOrder, cancelRevise, submitRevise } from './purchasing-approval.js';

// loadPartUsageForOrder — fetch 1yr + 3yr usage + PO purchase history for Research tab.
// Only fires for part orders. All 6 lookups run non-blocking in parallel.
export function loadPartUsageForOrder() {
    const order = store.purchasingDetailOrder.value;
    if (!order || order.request_type !== 'part' || !order.part_number) return;
    const pn = order.part_number.trim().toUpperCase();

    // Reset 1yr state
    store.purchasingPartUsage.value                   = null;
    store.purchasingPartParentUsage.value             = null;
    store.purchasingPartUsageLoading.value            = true;
    store.purchasingPartParentUsageLoading.value      = true;
    store.purchasingPartPurchaseHistory.value         = [];
    store.purchasingPartPurchaseHistoryLoading.value  = true;
    store.purchasingPartPurchaseHistoryError.value    = false;

    // Reset 3yr state
    store.purchasingPartUsage36mo.value                   = null;
    store.purchasingPartParentUsage36mo.value             = null;
    store.purchasingPartUsageLoading36mo.value            = true;
    store.purchasingPartParentUsageLoading36mo.value      = true;

    // 1yr summary + purchased
    Promise.all([db.fetchPartUsageSummary12Mo(pn), db.fetchPartPurchased12Mo(pn)])
        .then(([rpc, hist]) => {
            store.purchasingPartUsage.value = {
                qty_sold:           rpc.data?.qty_sold_used_12mo  || 0,
                qty_used_mfg:       rpc.data?.qty_used_in_mfg     || 0,
                qty_made:           rpc.data?.qty_made_past_12mo  || 0,
                qty_purchased_12mo: hist.qty_12mo                 || 0,
            };
            store.purchasingPartUsageLoading.value = false;
        })
        .catch(err => { store.purchasingPartUsageLoading.value = false; logError('loadPartUsageForOrder:1yr', err); });

    // 3yr summary + purchased
    Promise.all([db.fetchPartUsageSummary36Mo(pn), db.fetchPartPurchased36Mo(pn)])
        .then(([rpc, hist]) => {
            store.purchasingPartUsage36mo.value = {
                qty_sold:           rpc.data?.qty_sold_used_36mo   || 0,
                qty_used_mfg:       rpc.data?.qty_used_in_mfg_36mo || 0,
                qty_made:           rpc.data?.qty_made_past_36mo   || 0,
                qty_purchased_36mo: hist.qty_36mo                  || 0,
            };
            store.purchasingPartUsageLoading36mo.value = false;
        })
        .catch(err => { store.purchasingPartUsageLoading36mo.value = false; logError('loadPartUsageForOrder:3yr', err); });

    // 1yr parent BOM demand (rolling 12 months)
    const today      = new Date().toISOString().slice(0, 10);
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    db.calculateRecursiveParentUsageDemand(pn, oneYearAgo, today)
        .then(({ data, error }) => {
            store.purchasingPartParentUsageLoading.value = false;
            if (!error && data) store.purchasingPartParentUsage.value = data.totalDemand || null;
        })
        .catch(err => { store.purchasingPartParentUsageLoading.value = false; logError('loadPartUsageForOrder:parent1yr', err); });

    // 3yr parent BOM demand (fixed start 1/1/23, rolling end)
    db.calculateRecursiveParentUsageDemand(pn, PURCHASING_3YR_START, today)
        .then(({ data, error }) => {
            store.purchasingPartParentUsageLoading36mo.value = false;
            if (!error && data) store.purchasingPartParentUsage36mo.value = data.totalDemand || null;
        })
        .catch(err => { store.purchasingPartParentUsageLoading36mo.value = false; logError('loadPartUsageForOrder:parent3yr', err); });

    // Enriched purchase history (not time-scoped — shows last 3 purchases)
    db.fetchLastTwoPurchasesWithSupplier(pn)
        .then(({ data, error }) => {
            store.purchasingPartPurchaseHistoryLoading.value = false;
            if (error) { store.purchasingPartPurchaseHistoryError.value = true; logError('loadPartUsageForOrder:supplier', error); }
            else store.purchasingPartPurchaseHistory.value = data || [];
        })
        .catch(err => {
            store.purchasingPartPurchaseHistoryLoading.value = false;
            store.purchasingPartPurchaseHistoryError.value = true;
            logError('loadPartUsageForOrder:supplier', err);
        });
}

// ── Quotes ────────────────────────────────────────────────────

const BLANK_QUOTE = (sortOrder) => ({
    id:             null,
    sort_order:     sortOrder,
    supplier_name:  '',
    qty:            '',
    price:          '',
    lead_time:      '',
    shipping_price: '',
    terms:          '',
    quote_ref:      '',
    _saving:        false,
});

// loadOrderQuotes — fetch saved quotes and pad display list to 5 rows minimum.
export async function loadOrderQuotes() {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    store.purchasingDetailQuotesLoading.value = true;
    try {
        const { data, error } = await db.fetchPurchasingQuotes(order.id);
        if (error) throw error;

        // Map DB rows to editable form objects
        const rows = data.map(q => ({
            id:             q.id,
            sort_order:     q.sort_order,
            supplier_name:  q.supplier_name  || '',
            qty:            q.qty            ?? '',
            price:          q.price          ?? '',
            lead_time:      q.lead_time      || '',
            shipping_price: q.shipping_price ?? '',
            terms:          q.terms          || '',
            quote_ref:      q.quote_ref      || '',
            _saving:        false,
        }));

        // Pad to at least 5 rows
        const needed = Math.max(5, rows.length + 1);
        for (let i = rows.length + 1; i <= needed; i++) rows.push(BLANK_QUOTE(i));

        store.purchasingDetailQuotes.value = rows;
    } catch (err) {
        store.showToast('Failed to load quotes: ' + err.message);
        logError('loadOrderQuotes', err);
    } finally {
        store.purchasingDetailQuotesLoading.value = false;
    }
}

// saveQuote — upsert a single quote row to DB; skips if all fields are blank.
export async function saveQuote(row) {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;

    const hasData = row.supplier_name?.trim() || row.qty || row.price ||
                    row.lead_time?.trim() || row.shipping_price || row.terms?.trim() || row.quote_ref?.trim();
    if (!hasData) {
        store.showToast('Fill in at least one field before saving.', 'error');
        return;
    }

    row._saving = true;
    try {
        const fields = {
            purchasing_order_id: order.id,
            sort_order:          row.sort_order,
            supplier_name:       row.supplier_name?.trim()  || null,
            qty:                 parseFloat(row.qty)        || null,
            price:               parseFloat(row.price)      || null,
            lead_time:           row.lead_time?.trim()      || null,
            shipping_price:      parseFloat(row.shipping_price) || null,
            terms:               row.terms?.trim()          || null,
            quote_ref:           row.quote_ref?.trim()      || null,
        };
        if (row.id) fields.id = row.id;

        const { data, error } = await db.upsertPurchasingQuote(fields);
        if (error) throw error;

        row.id = data.id;
        store.showToast('Quote saved.', 'success');

        // Auto-advance status to 'quoting' the first time a quote is saved
        if (order.status === 'requested') {
            const now = new Date().toISOString();
            const { data: updated } = await db.updatePurchasingOrder(order.id, {
                status: 'quoting', last_status_update: now,
            });
            if (updated) {
                _replaceInStore(updated);
                store.purchasingDetailOrder.value      = updated;
                store.purchasingDetailForm.value.status = 'quoting';
                _formSnapshot = JSON.stringify(store.purchasingDetailForm.value);
                db.insertPurchasingEvent({
                    orderId: order.id, eventType: 'status_change',
                    oldStatus: 'requested', newStatus: 'quoting', createdBy: 'purchasing',
                });
            }
        }
    } catch (err) {
        store.showToast('Failed to save quote: ' + err.message);
        logError('saveQuote', err);
    } finally {
        row._saving = false;
    }
}

// addQuoteRow — append a blank quote row to the display list.
export function addQuoteRow() {
    const rows = store.purchasingDetailQuotes.value;
    rows.push(BLANK_QUOTE(rows.length + 1));
}

// removeQuoteRow — delete a saved quote from DB (if saved), then remove from list.
export async function removeQuoteRow(index) {
    const rows = store.purchasingDetailQuotes.value;
    const row  = rows[index];
    if (!row) return;

    if (row.id) {
        row._saving = true;
        try {
            const { error } = await db.deletePurchasingQuote(row.id);
            if (error) throw error;
        } catch (err) {
            store.showToast('Failed to delete quote: ' + err.message);
            logError('removeQuoteRow', err);
            row._saving = false;
            return;
        }
    }

    store.purchasingDetailQuotes.value = rows.filter((_, i) => i !== index);
}
