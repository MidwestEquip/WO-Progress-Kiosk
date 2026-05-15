// ============================================================
// pages/purchasing-view.js — Purchasing section business logic
//
// Handles: data loading, tab switching, new request form,
//          detail/edit modal, status changes, receiving.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

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
    material_type:             '',  // dropdown: Carbon/Aluminum/Galvanized/Stainless/__other__
    material_type_other:       '',  // free text when material_type === '__other__'
    steel_shape:               '',  // dropdown: Sheet/Plate/etc/__other__ (material form)
    steel_shape_other:         '',  // free text when steel_shape === '__other__'
    material_size:             '',
    material_thickness:        '',
    material_grade:            '',
    material_finish:           '',
});

// loadPurchasingOrders — fetch all active purchasing orders into store.
export async function loadPurchasingOrders() {
    store.purchasingLoading.value = true;
    try {
        const { data, error } = await db.fetchPurchasingOrders();
        if (error) throw error;
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
        if (!form.material_type)                                                        errors.material_type       = true;
        if (form.material_type === '__other__' && !form.material_type_other?.trim())    errors.material_type_other = true;
        if (!form.steel_shape)                                                          errors.steel_shape         = true;
        if (form.steel_shape   === '__other__' && !form.steel_shape_other?.trim())      errors.steel_shape_other   = true;
        if (!form.material_size?.trim())                                                errors.material_size       = true;
        if (!form.material_thickness?.trim())                                           errors.material_thickness  = true;
        if (!form.material_grade?.trim())                                               errors.material_grade      = true;
        if (!form.material_finish?.trim())                                              errors.material_finish     = true;
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
            fields.material_type      = form.material_type === '__other__'
                ? form.material_type_other.trim()
                : form.material_type;
            fields.steel_shape        = form.steel_shape === '__other__'
                ? (form.steel_shape_other?.trim() || null)
                : (form.steel_shape || null);
            fields.material_size          = form.material_size?.trim()          || null;
            fields.material_thickness     = form.material_thickness?.trim()     || null;
            fields.material_grade         = form.material_grade?.trim()         || null;
            fields.material_finish        = form.material_finish?.trim()        || null;
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
    store.purchasingPartUsage.value                   = null;
    store.purchasingPartParentUsage.value             = null;
    store.purchasingPartUsageLoading.value            = false;
    store.purchasingPartParentUsageLoading.value      = false;
    store.purchasingPartPurchaseHistory.value         = [];
    store.purchasingPartPurchaseHistoryLoading.value  = false;
    store.purchasingPartPurchaseHistoryError.value    = false;
    store.purchasingDetailOrder.value   = order;
    store.purchasingDetailSection.value = section;
    store.purchasingDetailForm.value = {
        status:               order.status               || 'requested',
        supplier_name:        order.supplier_name        || '',
        supplier_part_number: order.supplier_part_number || '',
        po_number:            order.po_number            || '',
        estimated_lead_time:  order.estimated_lead_time  ?? '',
        expected_date:        order.expected_date        || '',
        qty_ordered:          order.qty_ordered          ?? '',
        purchaser_notes:      order.purchaser_notes      || '',
        purchaser_questions:  order.purchaser_questions  || '',
        production_notes:     order.production_notes     || '',
    };
    store.purchasingReceiveForm.value = {
        qty_received: order.qty_received ?? '',
        received_by:  order.received_by  || '',
    };
    store.purchasingDetailOpen.value = true;
}

// closeOrderDetail — dismiss the detail modal.
export function closeOrderDetail() {
    store.purchasingDetailOpen.value = false;
}

// saveOrderDetail — persist ordering fields and status change.
export async function saveOrderDetail() {
    const order = store.purchasingDetailOrder.value;
    const form  = store.purchasingDetailForm.value;

    const updates = {
        status:               form.status,
        supplier_name:        form.supplier_name?.trim()        || null,
        supplier_part_number: form.supplier_part_number?.trim() || null,
        po_number:            form.po_number?.trim()            || null,
        estimated_lead_time:  parseFloat(form.estimated_lead_time) || null,
        expected_date:        form.expected_date                || null,
        qty_ordered:          parseFloat(form.qty_ordered)      || null,
        purchaser_notes:      form.purchaser_notes?.trim()      || null,
        purchaser_questions:  form.purchaser_questions?.trim()  || null,
        production_notes:     form.production_notes?.trim()     || null,
    };

    // Auto-calculate expected_date from lead time when not manually set
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
        store.purchasingDetailOpen.value = false;
        store.showToast('Order updated.', 'success');

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
        logError('saveOrderDetail', err);
    } finally {
        store.purchasingDetailSaving.value = false;
    }
}

// submitReceiving — record quantity received; auto-sets status.
export async function submitReceiving() {
    const order       = store.purchasingDetailOrder.value;
    const form        = store.purchasingReceiveForm.value;
    const qtyReceived = parseFloat(form.qty_received) || 0;
    // Use qty_ordered as the "full" amount; fall back to qty_needed
    const qtyFull     = parseFloat(order.qty_ordered) || parseFloat(order.qty_needed) || qtyReceived;

    if (qtyReceived <= 0) {
        store.showToast('Enter a quantity received greater than 0.', 'error');
        return;
    }
    if (!form.received_by?.trim()) {
        store.showToast('Enter the name of who received the order.', 'error');
        return;
    }

    const newStatus   = qtyReceived >= qtyFull ? 'received' : 'partially_received';
    const now         = new Date().toISOString();
    const updates     = {
        qty_received:        qtyReceived,
        received_by:         form.received_by.trim(),
        received_at:         now,
        status:              newStatus,
        last_status_update:  now,
    };
    if (newStatus === 'received') updates.completed_at = now;

    store.purchasingReceiveSaving.value = true;
    try {
        const { data, error } = await db.updatePurchasingOrder(order.id, updates);
        if (error) throw error;

        // Fully received → remove from active list
        if (newStatus === 'received') {
            store.purchasingOrders.value = store.purchasingOrders.value.filter(o => o.id !== order.id);
        } else {
            _replaceInStore(data);
        }

        store.purchasingDetailOpen.value = false;
        store.showToast(
            newStatus === 'received' ? 'Order fully received — moved to Completed.' : 'Partial receipt saved.',
            'success'
        );

        db.insertPurchasingEvent({
            orderId:   order.id,
            eventType: 'receiving',
            note:      `Received ${qtyReceived} by ${form.received_by.trim()}`,
            oldStatus: order.status,
            newStatus,
            createdBy: form.received_by.trim(),
        });
    } catch (err) {
        store.showToast('Failed to record receiving: ' + err.message);
        logError('submitReceiving', err);
    } finally {
        store.purchasingReceiveSaving.value = false;
    }
}

function _replaceInStore(updated) {
    store.purchasingOrders.value = store.purchasingOrders.value.map(o =>
        o.id === updated.id ? updated : o
    );
}

// loadPartUsageForOrder — fetch 12mo usage + PO purchase history for Request Info tab.
// Only fires for part orders. All 3 lookups run in parallel (non-blocking).
export function loadPartUsageForOrder() {
    const order = store.purchasingDetailOrder.value;
    if (!order || order.request_type !== 'part' || !order.part_number) return;
    const pn = order.part_number.trim().toUpperCase();

    store.purchasingPartUsage.value                   = null;
    store.purchasingPartParentUsage.value             = null;
    store.purchasingPartUsageLoading.value            = true;
    store.purchasingPartParentUsageLoading.value      = true;
    store.purchasingPartPurchaseHistory.value         = [];
    store.purchasingPartPurchaseHistoryLoading.value  = true;
    store.purchasingPartPurchaseHistoryError.value    = false;

    Promise.all([db.fetchPartUsageSummary12Mo(pn), db.fetchPartPurchased12Mo(pn)])
        .then(([rpc, hist]) => {
            store.purchasingPartUsage.value = {
                qty_sold:           rpc.data?.qty_sold_used_12mo  || 0,
                qty_used_mfg:       rpc.data?.qty_used_in_mfg     || 0,
                qty_made:           rpc.data?.qty_made_past_12mo  || 0,
                qty_purchased_12mo: hist.qty_12mo                 || 0,
                recent_purchases:   hist.data                     || [],
            };
            store.purchasingPartUsageLoading.value = false;
        })
        .catch(err => { store.purchasingPartUsageLoading.value = false; logError('loadPartUsageForOrder', err); });

    db.calculateRecursiveParentUsageDemand(pn)
        .then(({ data, error }) => {
            store.purchasingPartParentUsageLoading.value = false;
            if (!error && data) store.purchasingPartParentUsage.value = data.totalDemand || null;
        })
        .catch(err => { store.purchasingPartParentUsageLoading.value = false; logError('loadPartUsageForOrder:parent', err); });

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
