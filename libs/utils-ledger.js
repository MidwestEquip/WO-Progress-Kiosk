// ============================================================
// libs/utils-ledger.js — Pure native-inventory-ledger row builders
//
// Split from libs/utils.js (500-line cap). Same rules as utils.js:
//  - No side effects, no imports, no state
//  - Every function is independently testable
// Re-exported by libs/utils.js so existing `from './utils.js'`
// imports keep resolving unchanged.
//
// Doctype/trantype values are the vocabulary mirror of INVENTORY_TXN in
// config.js (this file takes no imports). Builders are pure: no clock, no
// randomness — txn_date and source are stamped by insertInventoryTxns in
// db-open-orders.js. Every row carries a deterministic native_event_key
// so replays collapse against the unique index (conflict-ignore).
// part_number_normalized is trim+UPPER (mirror of normalizePartNumber);
// the DB BEFORE trigger recomputes it authoritatively on insert.
// ============================================================

// _localDateString — YYYY-MM-DD from a Date, local timezone (pure formatting).
function _localDateString(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// buildWoCloseoutTxns — ledger rows for one WO closeout: one MO/I (finished
// part into stock) + one MO/O per direct BOM child (single-level backflush,
// qty_per_assy x qty, duplicate BOM lines summed per child).
// Inputs: tracking = wo_status_tracking row { id, wo_number, part_number },
//         qty      = closed-out quantity (must be > 0),
//         bomChildren = [{ item_child, item_child_normalized, qty_per_assy }]
// Output: array of issues_receipts row objects ([] when inputs are invalid).
export function buildWoCloseoutTxns(tracking, qty, bomChildren) {
    const q = Number(qty);
    if (!tracking?.id || !tracking.part_number?.trim() || !Number.isFinite(q) || q <= 0) return [];

    const part  = tracking.part_number.trim().toUpperCase();
    const docid = (tracking.wo_number || '').toString().trim().slice(0, 50) || null;

    const rows = [{
        part_number:            part,
        part_number_normalized: part,
        doctype:  'MO',
        trantype: 'I',
        qty:      q,
        docid,
        native_event_key: `closeout|${tracking.id}|MO|I`,
    }];

    // Sum consumption per child so duplicate BOM lines share one row/key.
    const perChild = {};
    (bomChildren || []).forEach(c => {
        const childNorm = (c.item_child_normalized || c.item_child || '').trim().toUpperCase();
        if (!childNorm || childNorm === part) return; // skip blanks and self-references
        const per = Number(c.qty_per_assy);
        const use = (Number.isFinite(per) && per > 0 ? per : 1) * q;
        if (!perChild[childNorm]) {
            perChild[childNorm] = { part_number: (c.item_child || childNorm).trim().toUpperCase(), total: 0 };
        }
        perChild[childNorm].total += use;
    });
    Object.entries(perChild).forEach(([childNorm, info]) => {
        rows.push({
            part_number:            info.part_number,
            part_number_normalized: childNorm,
            doctype:  'MO',
            trantype: 'O',
            qty:      info.total,
            docid,
            native_event_key: `closeout|${tracking.id}|MO|O|${childNorm}`,
        });
    });

    return rows;
}

// buildOpenOrderSoldTxns — SO/O sold-at-entry rows for freshly inserted open
// order rows (the native Qty Sold leg; no on-hand effect). Rows without a
// part number or a positive to_ship are skipped. txn_date stamped at insert.
// Input: array of inserted open_orders rows. Output: issues_receipts rows.
export function buildOpenOrderSoldTxns(insertedRows) {
    const txns = [];
    (insertedRows || []).forEach(r => {
        const qty  = Number(r?.to_ship);
        const part = (r?.part_number || '').trim().toUpperCase();
        if (!r?.id || !part || !Number.isFinite(qty) || qty <= 0) return;
        txns.push({
            part_number:            part,
            part_number_normalized: part,
            doctype:  'SO',
            trantype: 'O',
            qty,
            docid: (r.sales_order || '').toString().trim().slice(0, 50) || null,
            native_event_key: `oo|${r.id}|SO|O`,
        });
    });
    return txns;
}

// buildOpenOrderTerminalTxns — ledger rows for a board row leaving open_orders.
//   'Shipped'             → SO/S (+qty): stock out (never counted as sold).
//   'Deleted'/'Cancelled' → negative SO/O reversal dated max(add date, cutover),
//     so it always nets the row's positive — the add-time SO/O, or the go-live
//     backfill row (dated exactly at the cutover). Clamped, never skipped.
// Other statuses emit nothing. Inputs: row = full open_orders object,
// finalStatus, cutoverDate 'YYYY-MM-DD'. Output: issues_receipts rows.
export function buildOpenOrderTerminalTxns(row, finalStatus, cutoverDate) {
    const qty  = Number(row?.to_ship);
    const part = (row?.part_number || '').trim().toUpperCase();
    if (!row?.id || !part || !Number.isFinite(qty) || qty <= 0) return [];
    const base = {
        part_number:            part,
        part_number_normalized: part,
        docid: (row.sales_order || '').toString().trim().slice(0, 50) || null,
    };
    if (finalStatus === 'Shipped') {
        return [{ ...base, doctype: 'SO', trantype: 'S', qty, native_event_key: `oo|${row.id}|SO|S` }];
    }
    if (finalStatus === 'Deleted' || finalStatus === 'Cancelled') {
        const added    = row.created_at ? _localDateString(new Date(row.created_at)) : null;
        const txn_date = (added && added > cutoverDate) ? added : cutoverDate;
        return [{ ...base, doctype: 'SO', trantype: 'O', qty: -qty, txn_date, native_event_key: `oo|${row.id}|SO|O|rev` }];
    }
    return [];
}

// buildPoReceiveTxn — PO/I ledger row for a FULLY received purchasing order
// (stock in + native purchase history). Part-type orders only: supply and
// steel orders are skipped (no part_number to track; steel descriptions would
// pollute part metrics). Re-saves of an already-received order re-use the
// same key and collapse. Partial receipts deliberately emit nothing (v1 gap).
// Inputs: order = purchasing_orders row (post-update), qtyReceived (> 0).
// Output: issues_receipts rows ([] when not applicable).
export function buildPoReceiveTxn(order, qtyReceived) {
    const qty  = Number(qtyReceived);
    const part = (order?.part_number || '').trim().toUpperCase();
    if (!order?.id || order.request_type !== 'part' || !part) return [];
    if (!Number.isFinite(qty) || qty <= 0) return [];
    return [{
        part_number:            part,
        part_number_normalized: part,
        doctype:  'PO',
        trantype: 'I',
        qty,
        docid: (order.po_number || '').toString().trim().slice(0, 50) || null,
        native_event_key: `po|${order.id}|PO|I`,
    }];
}

// buildOpenOrderRestoreTxns — compensation rows when a completed row returns
// to the board. Shipped restores reverse their SO/S (stock back in), keyed on
// original_id; rows shipped before the cutover never had an SO/S, so they're
// skipped (nothing to reverse). Deleted/Cancelled restores re-book the sale
// as a fresh SO/O keyed on the NEW board row id (their original SO/O was
// reversed when they left the board). Inputs: completedRow =
// open_orders_completed object, freshId = new board row id (caller-generated),
// cutoverDate 'YYYY-MM-DD'. Output: issues_receipts rows.
export function buildOpenOrderRestoreTxns(completedRow, freshId, cutoverDate) {
    const qty  = Number(completedRow?.to_ship);
    const part = (completedRow?.part_number || '').trim().toUpperCase();
    if (!part || !Number.isFinite(qty) || qty <= 0) return [];
    const base = {
        part_number:            part,
        part_number_normalized: part,
        docid: (completedRow.sales_order || '').toString().trim().slice(0, 50) || null,
    };
    if (completedRow.status === 'Shipped') {
        if (!completedRow.original_id) return []; // pre-feature rows: nothing keyed to reverse
        const shipped = completedRow.shipped_at ? _localDateString(new Date(completedRow.shipped_at)) : null;
        if (shipped && shipped < cutoverDate) return []; // shipped pre-ledger: no SO/S exists
        return [{ ...base, doctype: 'SO', trantype: 'S', qty: -qty, native_event_key: `oo|${completedRow.original_id}|SO|S|rev` }];
    }
    if (completedRow.status === 'Deleted' || completedRow.status === 'Cancelled') {
        if (!freshId) return [];
        return [{ ...base, doctype: 'SO', trantype: 'O', qty, native_event_key: `oo|${freshId}|SO|O` }];
    }
    return [];
}
