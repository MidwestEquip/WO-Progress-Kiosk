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

// verifyInStock — shipping has confirmed the part is physically present, but has
// not pulled/staged it yet. New → In Stock (the verification step before Picked).
export function verifyInStock(order) {
    return _triageOpenOrder(order, 'In Stock');
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
    // Backordered lines are held, not picked — exclude them from the ticket.
    const items = so
        ? store.openOrders.value.filter(o => (o.sales_order || '').trim() === so && !o.backordered)
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
    const { error, ledgerError } = await db.shipOpenOrder({ ...order, status: 'Shipped', last_status_update: now });
    if (error) {
        store.showToast(`Failed to ship row: ${error.message}`);
        logError('markShipped', error);
        return;
    }
    if (ledgerError) store.showToast(`Shipped, but inventory ledger did not record: ${ledgerError.message}`);
    store.openOrders.value = store.openOrders.value.filter(o => o.id !== order.id);
}

// Backorder actions (openBackorderModal / submitBackorder / unBackorderRow) live
// in pages/open-orders-backorder.js — split for the 500-line cap.

// ── Waiting On (subparts blocking a ship) ─────────────────────
// A row can be waiting on several missing subparts, each { part_number,
// wo_number }. The subpart WO's live status is derived (woStatusByNumber), never
// stored. Entries carry a client-only _k for stable v-for keys.
const WAITING_MAX_ENTRIES = 20;   // cap entries per row
const WAITING_FIELD_MAXLEN = 64;  // cap each field's stored length
let _waitingKeyCounter = 0;

// openWaitingModal — open the Waiting On editor for one open_orders row,
// pre-filling its existing entries (guards NULL waiting_on on old rows).
export function openWaitingModal(order) {
    if (!order?.id) return;
    store.openOrderWoMenuRow.value = null;
    store.waitingOnRow.value = order;
    const existing = Array.isArray(order.waiting_on) ? order.waiting_on : [];
    store.waitingOnForm.value = {
        entries: existing.map(e => ({
            _k: ++_waitingKeyCounter,
            part_number: (e?.part_number || '').toString(),
            wo_number:   (e?.wo_number   || '').toString(),
            requested:   !!e?.requested,
        })),
    };
    store.waitingOnErrors.value = {};
    store.waitingOnModalOpen.value = true;
    loadWaitingOnWoStatuses(); // refresh live status for the saved entries
}

// closeWaitingModal — dismiss + reset the Waiting On editor.
export function closeWaitingModal() {
    store.waitingOnModalOpen.value = false;
    store.waitingOnRow.value = null;
    store.waitingOnForm.value = { entries: [] };
    store.waitingOnErrors.value = {};
}

// addWaitingEntry — append a blank subpart row (capped).
export function addWaitingEntry() {
    const entries = store.waitingOnForm.value.entries;
    if (entries.length >= WAITING_MAX_ENTRIES) {
        store.showToast(`Max ${WAITING_MAX_ENTRIES} waiting-on entries per row.`);
        return;
    }
    entries.push({ _k: ++_waitingKeyCounter, part_number: '', wo_number: '', requested: false });
}

// removeWaitingEntry — drop one subpart row by index.
export function removeWaitingEntry(idx) {
    store.waitingOnForm.value.entries.splice(idx, 1);
}

// saveWaitingOn — sanitize + persist the entries to open_orders.waiting_on.
// Whitelists keys, trims/uppercases part# and wo#, caps field length + count,
// drops fully-blank rows. Writes null when the list is empty (clears the column).
export async function saveWaitingOn() {
    const row = store.waitingOnRow.value;
    if (!row?.id) return;
    const clean = [];
    for (const e of store.waitingOnForm.value.entries) {
        const part = (e.part_number || '').trim().toUpperCase().slice(0, WAITING_FIELD_MAXLEN);
        const wo   = (e.wo_number   || '').trim().toUpperCase().slice(0, WAITING_FIELD_MAXLEN);
        if (!part && !wo) continue;
        // Whitelist: only these keys are ever written. requested is a boolean we
        // set on the Req-WO action; preserve it (omit when false to keep rows lean).
        const entry = { part_number: part, wo_number: wo };
        if (e.requested) entry.requested = true;
        if (e.in_stock) entry.in_stock = true;   // set by the Receiving modal; preserve it
        clean.push(entry);
        if (clean.length >= WAITING_MAX_ENTRIES) break;
    }
    store.waitingOnSaving.value = true;
    try {
        const waiting_on = clean.length ? clean : null;
        const { error } = await db.updateOpenOrder(row.id, { waiting_on });
        if (error) throw error;
        store.openOrders.value = store.openOrders.value.map(o =>
            o.id === row.id ? { ...o, waiting_on } : o);
        closeWaitingModal();
        loadWaitingOnWoStatuses(); // pick up statuses for any newly-entered WO#s
    } catch (err) {
        store.showToast('Failed to save Waiting On: ' + err.message);
        logError('saveWaitingOn', err);
    } finally {
        store.waitingOnSaving.value = false;
    }
}

// reqWoForSubpart — pre-fill the WO Request form for a waiting-on subpart and
// jump to the request view. Mirrors requestWoFromOpenOrder (page files never
// import each other, so the store sets are inlined). Creates no record itself.
// parentRow defaults to the modal's row; the board column passes its own row.
export function reqWoForSubpart(entry, parentRow) {
    const parent = parentRow || store.waitingOnRow.value;
    const part = (entry?.part_number || '').trim().toUpperCase();
    if (!part) { store.showToast('Enter the subpart part # first.'); return; }

    // Mark this subpart as WO-requested on the row and persist, so on return the
    // button is replaced by "WO Requested" (until the created WO auto-links).
    if (parent?.id) {
        const list = Array.isArray(parent.waiting_on) ? parent.waiting_on : [];
        const updated = list.map(e =>
            e === entry || (e.part_number === entry.part_number && (e.wo_number || '') === (entry.wo_number || ''))
                ? { ...e, requested: true } : e);
        store.openOrders.value = store.openOrders.value.map(o =>
            o.id === parent.id ? { ...o, waiting_on: updated } : o);
        db.updateOpenOrder(parent.id, { waiting_on: updated }); // non-blocking
    }

    store.woRequestForm.value = {
        part_number:        part,
        description:        '',
        sales_order_number: parent?.sales_order || '',
        qty_on_order:       parent?.to_ship ?? '',
        qty_in_stock: '', qty_used_per_unit: '',
        submitted_by: '', is_assembly: false,
    };
    store.woRequestFormErrors.value = { part_number: false, qty_in_stock: false, qty_used_per_unit: false, submitted_by: false };
    store.woRequestSoHint.value     = null;
    store.woRequestActiveWos.value  = { part: '', items: [] };
    closeWaitingModal();
    store.splashLevel.value    = 1;
    store.splashCategory.value = 'production';
    store.currentView.value    = 'wo_request';
}

// loadWaitingOnWoStatuses — collect every waiting-on subpart's WO# and PART#
// across the board (two bounded, deduped queries) and stash the rows for the
// woStatusByNumber (manual WO#) and woInfoByPart (auto-linked by part) maps.
// Non-fatal: on failure the maps stay empty and the column shows '—'.
export async function loadWaitingOnWoStatuses() {
    const nums = [], parts = [];
    for (const o of store.openOrders.value) {
        const list = Array.isArray(o.waiting_on) ? o.waiting_on : [];
        for (const e of list) {
            const wo   = (e?.wo_number   || '').trim();
            const part = (e?.part_number || '').trim();
            if (wo)   nums.push(wo);
            if (part) parts.push(part);
        }
    }
    try {
        if (nums.length) {
            const { data, error } = await db.fetchWorkOrderStatuses(nums);
            if (error) throw error;
            store.waitingOnWoRows.value = data || [];
        } else {
            store.waitingOnWoRows.value = [];
        }
    } catch (err) {
        logError('loadWaitingOnWoStatuses:byNumber', err);
    }
    try {
        if (parts.length) {
            // Includes WOs still awaiting their official Alere WO# (job_number only),
            // so a freshly-created subpart WO links + shows status right away.
            const { data, error } = await db.fetchWaitingOnWosForParts(parts);
            if (error) throw error;
            store.waitingOnWoByPartRows.value = data || [];
        } else {
            store.waitingOnWoByPartRows.value = [];
        }
    } catch (err) {
        logError('loadWaitingOnWoStatuses:byPart', err);
    }
}

// ── Subpart WO display helpers (pure reads of the two maps) ────
// Return primitives only (no new objects/arrays) so they're safe to call in the
// template. A subpart resolves its WO from a manually-typed wo_number first, else
// auto-links via its part number (woInfoByPart).

// subpartWoNumber — the WO# for a waiting-on entry ('' if none yet).
export function subpartWoNumber(entry) {
    const manual = (entry?.wo_number || '').trim().toUpperCase();
    if (manual) return manual;
    const part = (entry?.part_number || '').trim().toUpperCase();
    return store.woInfoByPart.value[part]?.wo_number || '';
}

// subpartWoIsPending — true when the entry's WO is auto-linked via job_number, i.e.
// it's been created but is still awaiting its official Alere WO# (so the number shown
// is an internal "Job #", not a "WO #"). A manually-typed WO# is treated as official.
export function subpartWoIsPending(entry) {
    const manual = (entry?.wo_number || '').trim().toUpperCase();
    if (manual) return false;
    const part = (entry?.part_number || '').trim().toUpperCase();
    return !!store.woInfoByPart.value[part]?.pending;
}

// subpartWoStatus — the raw work_orders status for a waiting-on entry ('' if none).
export function subpartWoStatus(entry) {
    const manual = (entry?.wo_number || '').trim().toUpperCase();
    if (manual) return store.woStatusByNumber.value[manual] || '';
    const part = (entry?.part_number || '').trim().toUpperCase();
    return store.woInfoByPart.value[part]?.status || '';
}

// subpartStatusLabel — friendly label: any active WO reads "In Progress",
// a completed one "Complete", unknown "—".
export function subpartStatusLabel(entry) {
    const s = subpartWoStatus(entry);
    if (!s) return '—';
    return s === 'completed' ? 'Complete' : 'In Progress';
}

// subpartStatusClass — badge classes matching subpartStatusLabel.
export function subpartStatusClass(entry) {
    const s = subpartWoStatus(entry);
    if (!s) return 'bg-slate-100 text-slate-500';
    return s === 'completed' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800';
}
