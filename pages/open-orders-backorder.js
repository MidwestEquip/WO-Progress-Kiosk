// ============================================================
// pages/open-orders-backorder.js — Backorder one open-order line
//
// A backordered line is held (separated from its sales order) while the rest
// of the SO ships. The `backordered` flag is stored on open_orders, independent
// of status, so the row keeps its real workflow state. A partial backorder
// splits the line: the original keeps the ship-now qty; a new flagged remainder
// row carries the backordered qty. Split from open-orders-shipping.js to respect
// the 500-line cap. Imports from store + db + utils only. Never imported by
// another page file.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { isChutePart } from '../libs/utils.js';
import { OPEN_ORDER_STATUS_NEW } from '../libs/config.js';
import { logError } from '../libs/db-shared.js';

// openBackorderModal — open the qty modal for one row (defaults to the full line).
export function openBackorderModal(order) {
    if (!order?.id) return;
    store.backorderRow.value = order;
    store.backorderForm.value = { qty: order.to_ship ?? '' };
    store.backorderErrors.value = {};
    store.backorderModalOpen.value = true;
}

// closeBackorderModal — dismiss + reset the backorder modal.
export function closeBackorderModal() {
    store.backorderModalOpen.value = false;
    store.backorderRow.value = null;
    store.backorderForm.value = { qty: '' };
    store.backorderErrors.value = {};
}

// submitBackorder — flag the whole line, or split it and flag the remainder.
// Whole line (no qty, or qty >= to_ship): set backordered=true in place.
// Partial (qty < to_ship): reduce the original's to_ship to the ship-now amount
// and insert a new backordered remainder row copying the line's identity.
export async function submitBackorder() {
    const row = store.backorderRow.value;
    if (!row?.id) return;
    const toShip = Number(row.to_ship);
    const hasQty = Number.isFinite(toShip) && toShip > 0;
    const q = Number(store.backorderForm.value.qty);

    const errors = {};
    if (hasQty && (!Number.isFinite(q) || q <= 0 || q > toShip)) errors.qty = true;
    store.backorderErrors.value = errors;
    if (Object.keys(errors).length) return;

    store.backorderSaving.value = true;
    try {
        const now = new Date().toISOString();
        // Whole line — flag in place, no split.
        if (!hasQty || q >= toShip) {
            const { error } = await db.updateOpenOrder(row.id, { backordered: true });
            if (error) throw error;
            store.openOrders.value = store.openOrders.value.map(o =>
                o.id === row.id ? { ...o, backordered: true } : o);
        } else {
            // Partial — original keeps the ship-now qty; remainder is flagged.
            const shipNow = toShip - q;
            const remainder = {
                part_number:      row.part_number,
                description:      row.description       ?? null,
                customer:         row.customer          ?? null,
                sales_order:      row.sales_order       ?? null,
                wo_po_number:     row.wo_po_number      ?? null,
                to_ship:          q,
                qty_pulled:       null,   // nothing pulled/staged for the held qty
                date_entered:     row.date_entered      ?? null,
                deadline:         row.deadline          ?? null,
                store_bin:        row.store_bin         ?? null,
                update_store_bin: row.update_store_bin  ?? null,
                status:           row.status            ?? OPEN_ORDER_STATUS_NEW,
                last_status_update: now,
                wo_va_notes:      row.wo_va_notes       ?? null,
                order_type:       row.order_type,
                waiting_on:       Array.isArray(row.waiting_on) ? row.waiting_on : null,
                row_color:        row.row_color         ?? null,
                backordered:      true,
                ...(isChutePart(row.part_number) ? {
                    chute_status:           row.chute_status           ?? 'New/Picking',
                    bracket_adapter_status: row.bracket_adapter_status ?? 'New/Picking',
                } : {}),
            };
            const insRes = await db.insertOpenOrders([remainder]);
            if (insRes.error) throw insRes.error;
            const updRes = await db.updateOpenOrder(row.id, { to_ship: shipNow });
            if (updRes.error) throw updRes.error;

            store.openOrders.value = store.openOrders.value.map(o =>
                o.id === row.id ? { ...o, to_ship: shipNow } : o);
            // Realtime may have already delivered the new row — append only if missing.
            const have  = new Set(store.openOrders.value.map(o => o.id));
            const fresh = (insRes.data || []).filter(r => !have.has(r.id));
            if (fresh.length) store.openOrders.value = [...store.openOrders.value, ...fresh];
        }
        store.showToast('Backordered.', 'success');
        closeBackorderModal();
        store.openOrderSelectedIds.value = [];
    } catch (err) {
        store.showToast('Failed to backorder: ' + err.message);
        logError('submitBackorder', err);
    } finally {
        store.backorderSaving.value = false;
    }
}

// unBackorderRow — clear the backordered flag (rejoins its SO group). Does not
// merge a previously split remainder back into its sibling — adjust qty inline.
export async function unBackorderRow(order) {
    if (!order?.id) return;
    const { error } = await db.updateOpenOrder(order.id, { backordered: false });
    if (error) {
        store.showToast('Failed to un-backorder: ' + error.message);
        logError('unBackorderRow', error);
        return;
    }
    store.openOrders.value = store.openOrders.value.map(o =>
        o.id === order.id ? { ...o, backordered: false } : o);
    store.openOrderSelectedIds.value = [];
}
