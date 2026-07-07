// ============================================================
// pages/purchasing-quotes-view.js — Cross-order quote builder
//
// Handles: quote builder modal, All Quotes tab, place-order flow.
// Split from purchasing-view.js to stay under the 500-line cap.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { _replaceInStore } from './purchasing-receive.js';

// openQuoteBuilder — reset builder state and open the modal.
export function openQuoteBuilder() {
    store.quoteBuilderSelectedOrders.value = [];
    store.quoteBuilderItems.value          = {};
    store.quoteBuilderForm.value           = { supplier_name: '', quote_ref: '', terms: '', shipping_price: '' };
    store.quoteBuilderPendingFiles.value   = [];
    store.quoteBuilderOpen.value           = true;
}

// stageQuoteFile — add a file to the pending upload list for the quote builder.
export function stageQuoteFile(file) {
    if (!file) return;
    store.quoteBuilderPendingFiles.value = [...store.quoteBuilderPendingFiles.value, file];
}

// unstageQuoteFile — remove a staged file by index.
export function unstageQuoteFile(index) {
    store.quoteBuilderPendingFiles.value = store.quoteBuilderPendingFiles.value.filter((_, i) => i !== index);
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

        // Upload any staged attachments to quotes/{quoteId}/{filename}
        const pendingFiles = store.quoteBuilderPendingFiles.value;
        for (const file of pendingFiles) {
            const { error: upErr } = await db.uploadMasterQuoteAttachment(quote.id, file);
            if (upErr) store.showToast(`Attachment "${file.name}" failed: ${upErr.message}`, 'error');
        }

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

// ── Detail-modal quotes tab ───────────────────────────────────
// Moved from purchasing-view.js (500-line cap split). These drive the
// Quotes tab inside the order detail modal, not the cross-order builder.

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

        // Auto-advance status to 'quoting' the first time a quote is saved.
        // (The detail form's deep watcher in purchasing-view.js sees the status
        // change and fires one redundant-but-harmless autosave of equal values.)
        if (order.status === 'requested') {
            const now = new Date().toISOString();
            const { data: updated } = await db.updatePurchasingOrder(order.id, {
                status: 'quoting', last_status_update: now,
            });
            if (updated) {
                _replaceInStore(updated);
                store.purchasingDetailOrder.value      = updated;
                store.purchasingDetailForm.value.status = 'quoting';
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
