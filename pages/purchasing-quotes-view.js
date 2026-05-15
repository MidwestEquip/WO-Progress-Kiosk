// ============================================================
// pages/purchasing-quotes-view.js — Cross-order quote builder
//
// Handles: quote builder modal, All Quotes tab, place-order flow.
// Split from purchasing-view.js to stay under the 500-line cap.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// openQuoteBuilder — reset builder state and open the modal.
export function openQuoteBuilder() {
    store.quoteBuilderSelectedOrders.value = [];
    store.quoteBuilderItems.value          = {};
    store.quoteBuilderForm.value           = { supplier_name: '', quote_ref: '', terms: '', shipping_price: '' };
    store.quoteBuilderOpen.value           = true;
}

// closeQuoteBuilder — dismiss the modal without saving.
export function closeQuoteBuilder() {
    store.quoteBuilderOpen.value = false;
}

// toggleQuoteOrder — add/remove an order from the current quote selection.
export function toggleQuoteOrder(order) {
    const selected = store.quoteBuilderSelectedOrders.value;
    const idx      = selected.findIndex(o => o.id === order.id);
    if (idx >= 0) {
        store.quoteBuilderSelectedOrders.value = selected.filter((_, i) => i !== idx);
        const items = { ...store.quoteBuilderItems.value };
        delete items[order.id];
        store.quoteBuilderItems.value = items;
    } else {
        store.quoteBuilderSelectedOrders.value = [...selected, order];
        store.quoteBuilderItems.value = {
            ...store.quoteBuilderItems.value,
            [order.id]: { qty: order.qty_needed ?? '', price: '', lead_time: '' },
        };
    }
}

// submitQuote — save master quote + line items; set all selected orders to 'quoted'.
export async function submitQuote() {
    const form     = store.quoteBuilderForm.value;
    const selected = store.quoteBuilderSelectedOrders.value;
    const items    = store.quoteBuilderItems.value;

    if (!form.supplier_name?.trim()) {
        store.showToast('Supplier name is required.', 'error');
        return;
    }
    if (selected.length === 0) {
        store.showToast('Select at least one item to quote.', 'error');
        return;
    }

    store.quoteBuilderSaving.value = true;
    try {
        const { data: quote, error: qErr } = await db.insertMasterQuote({
            supplier_name:  form.supplier_name.trim(),
            quote_ref:      form.quote_ref?.trim()          || null,
            terms:          form.terms?.trim()               || null,
            shipping_price: parseFloat(form.shipping_price) || null,
            status:         'active',
        });
        if (qErr) throw qErr;

        const lineItems = selected.map(order => ({
            quote_id:            quote.id,
            purchasing_order_id: order.id,
            qty:                 parseFloat(items[order.id]?.qty)   || null,
            price:               parseFloat(items[order.id]?.price) || null,
            lead_time:           items[order.id]?.lead_time?.trim() || null,
        }));
        const { error: liErr } = await db.insertMasterQuoteItems(lineItems);
        if (liErr) throw liErr;

        // Mark all selected orders as 'quoted'
        await Promise.all(selected.map(order =>
            db.updatePurchasingOrder(order.id, {
                status:             'quoted',
                last_status_update: new Date().toISOString(),
            })
        ));

        // Update local store
        const idSet = new Set(selected.map(o => o.id));
        store.purchasingOrders.value = store.purchasingOrders.value.map(o =>
            idSet.has(o.id) ? { ...o, status: 'quoted' } : o
        );

        store.quoteBuilderOpen.value = false;
        store.showToast(`Quote saved — ${selected.length} item(s) marked Quoted.`, 'success');
    } catch (err) {
        store.showToast('Failed to save quote: ' + err.message);
        logError('submitQuote', err);
    } finally {
        store.quoteBuilderSaving.value = false;
    }
}

// loadAllQuotes — fetch all purchasing quotes with line items + order details.
export async function loadAllQuotes() {
    store.allQuotesLoading.value = true;
    try {
        const { data, error } = await db.fetchAllMasterQuotes();
        if (error) throw error;
        store.allQuotes.value = data;
    } catch (err) {
        store.showToast('Failed to load quotes: ' + err.message);
        logError('loadAllQuotes', err);
    } finally {
        store.allQuotesLoading.value = false;
    }
}

// openQuoteOrder — show the inline PO# entry for a specific quote.
export function openQuoteOrder(quoteId) {
    store.quoteOrderingId.value = quoteId;
    store.quoteOrderPoNum.value = '';
}

// cancelQuoteOrder — hide the inline PO# entry without saving.
export function cancelQuoteOrder() {
    store.quoteOrderingId.value = null;
}

// submitQuoteOrder — place order: all items → 'ordered' + PO#, quote → 'ordered'.
export async function submitQuoteOrder(quote) {
    const poNumber = store.quoteOrderPoNum.value?.trim();
    if (!poNumber) {
        store.showToast('Enter a PO number.', 'error');
        return;
    }

    store.quoteOrderSaving.value = true;
    try {
        const orderIds = (quote.purchasing_quote_items || [])
            .map(i => i.purchasing_order_id)
            .filter(Boolean);

        await Promise.all(orderIds.map(orderId =>
            db.updatePurchasingOrder(orderId, {
                status:             'ordered',
                po_number:          poNumber,
                last_status_update: new Date().toISOString(),
            })
        ));

        await db.updateMasterQuote(quote.id, { status: 'ordered' });

        // Update local store
        const idSet = new Set(orderIds);
        store.purchasingOrders.value = store.purchasingOrders.value.map(o =>
            idSet.has(o.id) ? { ...o, status: 'ordered', po_number: poNumber } : o
        );
        store.allQuotes.value = store.allQuotes.value.map(q =>
            q.id === quote.id ? { ...q, status: 'ordered' } : q
        );

        store.quoteOrderingId.value = null;
        store.showToast(`PO# ${poNumber} placed — ${orderIds.length} item(s) set to Ordered.`, 'success');
    } catch (err) {
        store.showToast('Failed to place order: ' + err.message);
        logError('submitQuoteOrder', err);
    } finally {
        store.quoteOrderSaving.value = false;
    }
}
