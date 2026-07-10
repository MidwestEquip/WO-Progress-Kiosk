// ============================================================
// pages/open-orders-shipping.js — New Orders inbox triage actions
//
// The NEW ORDERS inbox (status === 'New') is where every imported/added
// order lands until shipping deals with it. These handlers move a row out
// of the inbox by setting its status; the brand-section computeds pick it
// up automatically by order_type. Split from open-orders-view.js to respect
// the 500-line cap. Imports from store + db + utils only. Never imported by
// another page file.
//
// Undo: mirrors bulkChangeStatus (the existing open_orders status changer),
// which sets no store.lastUndoAction — that undo path is work_orders/dept
// scoped. A mis-triage is reversed by the status dropdown/drag on the board.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// _triageOpenOrder — shared status change for a New Orders inbox row.
// Optimistically moves the row out of the inbox, writes the new status +
// last_status_update, and rolls the row back in-memory (with a toast) if the
// write fails so the UI never lies about the saved state.
async function _triageOpenOrder(order, newStatus) {
    if (!order?.id) return;
    const prevStatus = order.status;
    const now = new Date().toISOString();

    // Optimistic local update first so the row leaves the inbox immediately.
    store.openOrders.value = store.openOrders.value.map(o =>
        o.id === order.id ? { ...o, status: newStatus, last_status_update: now } : o);

    const { error } = await db.updateOpenOrder(order.id, { status: newStatus, last_status_update: now });
    if (error) {
        store.showToast(`Failed to update row: ${error.message}`);
        logError('_triageOpenOrder', error);
        store.openOrders.value = store.openOrders.value.map(o =>
            o.id === order.id ? { ...o, status: prevStatus } : o);
    }
}

// startPicking — shipping has the part in stock and has picked it.
// New → Picked (moves to the brand section; next step is boxing → ship).
export function startPicking(order) {
    return _triageOpenOrder(order, 'Picked');
}

// startAssembly — the part must be assembled before it can ship.
// New → In Progress (production/assembly underway in the brand section).
export function startAssembly(order) {
    return _triageOpenOrder(order, 'In Progress');
}

// ── Picking ticket ────────────────────────────────────────────

// Company identity block for the printed ticket header (left column).
const PICKING_TICKET_COMPANY = {
    name:  'Midwest Equipment Mfg.',
    lines: ['5225 SERUM PLANT ROAD', 'Thornton, IN 46071', 'US', '765-436-2496'],
};

// _ptDate — format a date value (ISO or Date) as MM/DD/YYYY for the ticket.
// Returns '' for null/blank so empty deadlines stay empty, like the paper form.
function _ptDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
}

// _ptQty — format a quantity like the paper form: "1.00 EA". Blank stays blank.
function _ptQty(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    return isNaN(n) ? '' : `${n.toFixed(2)} EA`;
}

// printPickingTicket — open a printable picking ticket listing every line item
// on this row's sales order (so shipping picks the whole order at once). Falls
// back to just this row when it has no sales order. Layout mirrors the Alere
// picking ticket: portrait, company header + "Picking Ticket" title, a green
// info-header band, then the yellow line-item grid. No Ship To block by design.
export function printPickingTicket(order) {
    const so = (order?.sales_order || '').trim();
    const items = so
        ? store.openOrders.value.filter(o => (o.sales_order || '').trim() === so)
        : [order].filter(Boolean);
    if (!items.length) { store.showToast('Nothing to print for this row'); return; }

    const esc = s => String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const today   = _ptDate(new Date());
    const orderDt = _ptDate(items.find(it => it.date_entered)?.date_entered) || today;
    const custPo  = items.find(it => it.wo_po_number)?.wo_po_number || '';

    const rowsHtml = items.map(it => `
        <tr>
            <td class="num">${esc(_ptQty(it.to_ship))}</td>
            <td class="num">${esc(_ptQty(it.qty_pulled))}</td>
            <td class="item">${esc(it.part_number)}</td>
            <td>${esc(it.description)}</td>
            <td class="bin">${esc(it.store_bin)}</td>
            <td class="bin">${esc(it.update_store_bin)}</td>
        </tr>`).join('');

    const companyLines = PICKING_TICKET_COMPANY.lines.map(l => esc(l)).join('<br>');

    const html = `<!doctype html><html><head><meta charset="utf-8">
        <title>Picking Ticket — SO ${esc(so || '(no SO)')}</title>
        <style>
            @page { size: portrait; margin: 0.5in; }
            *{box-sizing:border-box;}
            body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;}
            .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px;}
            .co-name{font-weight:bold;font-size:12px;}
            .co-addr{font-size:11px;line-height:1.35;margin-top:2px;}
            .doc-title{font-size:24px;font-weight:bold;text-align:right;margin:0;}
            .doc-so{font-size:14px;font-weight:bold;text-align:right;margin:2px 0 8px;}
            .doc-meta{font-size:11px;text-align:right;line-height:1.5;}
            .doc-meta span{color:#333;}
            table{width:100%;border-collapse:collapse;}
            .info-head th{background:#e2efda;border:1px solid #63955f;
                font-size:10px;font-weight:bold;text-align:left;padding:3px 5px;}
            .info-val td{border:1px solid #63955f;border-top:none;
                font-size:11px;padding:4px 5px;height:20px;color:#1f5c1f;}
            .lines{margin-top:14px;}
            .lines th{background:#e2efda;border:1px solid #63955f;
                font-size:10px;font-weight:bold;text-align:left;padding:3px 5px;}
            .lines td{background:#fdfdea;border:1px solid #d9d9a3;
                font-size:11px;padding:6px 5px;vertical-align:top;color:#1f5c1f;}
            .lines td.item{font-weight:bold;}
            .lines td.num{white-space:nowrap;}
            .lines td.bin{white-space:nowrap;}
            .lines th.num{white-space:nowrap;}
        </style></head><body>
        <div class="top">
            <div>
                <div class="co-name">${esc(PICKING_TICKET_COMPANY.name)}</div>
                <div class="co-addr">${companyLines}</div>
            </div>
            <div>
                <div class="doc-title">Picking Ticket</div>
                <div class="doc-so">Sales Order&nbsp;&nbsp;${esc(so || '—')}</div>
                <div class="doc-meta">
                    <span>Order Date:</span> ${esc(orderDt)}<br>
                    <span>Printed Date:</span> ${esc(today)}<br>
                    <span>Page:</span> 1
                </div>
            </div>
        </div>
        <table class="info">
            <thead class="info-head"><tr>
                <th>Purchase Order</th><th>Ship Via</th><th>F.O.B.</th>
                <th>Sales Rep</th><th>Ship From</th>
            </tr></thead>
            <tbody class="info-val"><tr>
                <td>${esc(custPo)}</td><td></td><td></td><td></td><td></td>
            </tr></tbody>
        </table>
        <table class="lines">
            <thead><tr>
                <th class="num">Qty to Ship</th><th class="num">Picked Qty</th>
                <th>Item Number</th><th>Description</th>
                <th>Bin Location</th><th>Updated Bin Location</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
        </body></html>`;

    const win = window.open('', '_blank', 'width=850,height=1000');
    if (!win) { store.showToast('Enable pop-ups to print picking tickets'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
}

// ── Boxed, Ready to Ship tab ──────────────────────────────────

// setShippingTab — switch the shipping board sub-tab ('orders' | 'boxed').
export function setShippingTab(tab) {
    store.shippingTab.value = tab;
}

// markShipped — ship one Boxed row: moves it to open_orders_completed (same
// path as the bulk Ship action) and removes it from the active board. Mirrors
// bulkChangeStatus's Shipped branch for a single row. Optimistic UI is safe
// because a failed ship leaves the row in place with an error toast.
export async function markShipped(order) {
    if (!order?.id) return;
    const now = new Date().toISOString();
    const { error } = await db.shipOpenOrder({ ...order, status: 'Shipped', last_status_update: now });
    if (error) {
        store.showToast(`Failed to ship row: ${error.message}`);
        logError('markShipped', error);
        return;
    }
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== order.id);
}
