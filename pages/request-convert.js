// ============================================================
// pages/request-convert.js — Request lifecycle actions (move / delete)
//
// Some parts are made in-house (WO request) and some are purchased
// (PO request). When one is filed on the wrong side, the move actions
// create the equivalent row on the other side and DELETE the original
// (a true move, no audit copy). Also handles deleting a PO request
// outright from its detail modal. Reuses existing db functions only.
// Imports from store + db + config. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { APP_LOCATION } from '../libs/config.js';

// moveWoRequestToOrder — convert the open WO request (must be 'pending') into a
// purchasing_orders part request, then delete the WO request. Used when a part that
// is actually purchased was mistakenly filed as a WO request.
export async function moveWoRequestToOrder() {
    const req = store.selectedWoRequest.value;
    if (!req) return;
    if (req.status !== 'pending') {
        store.showToast('Only pending requests can be moved.', 'error');
        return;
    }
    if (!confirm('Move this WO request to PO Ordering? The WO request will be deleted.')) return;

    store.loading.value = true;
    try {
        const fields = {
            request_type:           'part',
            part_number:            (req.part_number || '').trim().toUpperCase(),
            description:            req.description || null,
            sales_order:            req.sales_order_number || null,
            qty_needed:             req.qty_on_order ?? null,
            estimated_qty_in_stock: req.qty_in_stock ?? null,
            requested_by:           req.submitted_by || 'WO Request',
            requester_notes:        req.status_notes || null,
            request_location:       APP_LOCATION,
            ship_to:                APP_LOCATION,
            status:                 'requested',
            // Preserve the original request date rather than the move date.
            date_requested:         req.request_date || new Date().toISOString().slice(0, 10),
        };
        const { data, error } = await db.insertPurchasingOrder(fields);
        if (error) throw error;

        const { error: delErr } = await db.deleteWoRequest(req.id);
        if (delErr) throw delErr;

        // Drop from the WO request list + close the detail modal.
        store.woRequests.value     = store.woRequests.value.filter(r => r.id !== req.id);
        store.selectedWoRequest.value = null;
        store.woRequestReadOnly.value = false;
        // Surface it on the purchasing side immediately if that list is loaded.
        if (data) store.purchasingOrders.value = [data, ...store.purchasingOrders.value];

        store.showToast('Moved to PO Ordering.', 'success');
    } catch (err) {
        store.showToast('Failed to move to PO Ordering: ' + err.message, 'error');
        logError('moveWoRequestToOrder', err, { id: req.id });
    } finally {
        store.loading.value = false;
    }
}

// Statuses past which a PO is no longer a plain request and should not be moved.
const PO_LOCKED_STATUSES = new Set(['ordered', 'partially_received', 'received', 'canceled']);

// moveOrderToWoRequest — convert the open purchasing order (part or supply, not yet
// ordered) into a wo_requests row, then delete the purchasing order. Used when something
// we actually make in-house was mistakenly filed as a PO request.
export async function moveOrderToWoRequest() {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    if (order.request_type !== 'part' && order.request_type !== 'supply') {
        store.showToast('Only part or supply requests can become a WO request.', 'error');
        return;
    }
    if (PO_LOCKED_STATUSES.has(order.status)) {
        store.showToast('This order has already been ordered/received and cannot be moved.', 'error');
        return;
    }
    if (!confirm('Move this PO request to WO Request? The purchasing order will be deleted.')) return;

    store.purchasingDetailSaving.value = true;
    try {
        // Supply rows have no part number — fall back to the supply item name so the
        // WO request has a usable identifier (submitWoRequest requires part_number).
        const form = {
            part_number:        order.part_number || order.supply_item_name || '',
            description:         order.description || order.supply_item_name || '',
            sales_order_number: order.sales_order || '',
            qty_on_order:       order.qty_needed ?? '',
            qty_in_stock:       order.estimated_qty_in_stock ?? '',
            qty_used_per_unit:  '',
            submitted_by:       order.requested_by || 'Purchasing',
            is_assembly:        false,
            // Preserve the original request date rather than the move date.
            request_date:       order.date_requested || (order.created_at ? order.created_at.slice(0, 10) : null),
        };
        const { data, error } = await db.submitWoRequest(form);
        if (error) throw error;

        const { error: delErr } = await db.deletePurchasingOrder(order.id);
        if (delErr) throw delErr;

        // Drop from the purchasing list + close the detail modal.
        store.purchasingOrders.value = store.purchasingOrders.value.filter(o => o.id !== order.id);
        store.purchasingDetailOpen.value = false;
        // Surface it on the WO request side immediately if that list is loaded.
        if (data && data[0]) store.woRequests.value = [data[0], ...store.woRequests.value];

        store.showToast('Moved to WO Request.', 'success');
    } catch (err) {
        store.showToast('Failed to move to WO Request: ' + err.message, 'error');
        logError('moveOrderToWoRequest', err, { id: order.id });
    } finally {
        store.purchasingDetailSaving.value = false;
    }
}

// deleteOrderFromDetail — permanently delete the open purchasing order (header button
// in the detail modal). Mirrors deleteWoRequestItem on the WO side.
export async function deleteOrderFromDetail() {
    const order = store.purchasingDetailOrder.value;
    if (!order) return;
    if (!confirm('Delete this purchase order request? This cannot be undone.')) return;

    store.purchasingDetailSaving.value = true;
    try {
        const { error } = await db.deletePurchasingOrder(order.id);
        if (error) throw error;
        store.purchasingOrders.value = store.purchasingOrders.value.filter(o => o.id !== order.id);
        store.purchasingDetailOpen.value = false;
        store.showToast('Request deleted.', 'success');
    } catch (err) {
        store.showToast('Failed to delete request: ' + err.message, 'error');
        logError('deleteOrderFromDetail', err, { id: order.id });
    } finally {
        store.purchasingDetailSaving.value = false;
    }
}
