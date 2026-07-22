// ============================================================
// pages/open-orders-realtime.js — Open Orders realtime reconcile
//
// Surgical in-place merge of open_orders realtime payloads into
// store.openOrders (no full-list reload → no scroll/focus reset).
// Relocated verbatim from open-orders-view.js (500-line cap relief).
// Imports from store only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';

// _openOrderRowsEqualIgnoringVolatile — self-echo check; ignores the
// server-stamped updated_at so our own saves (already applied locally) don't
// force a re-render.
function _openOrderRowsEqualIgnoringVolatile(a, b) {
    if (!a || !b) return false;
    const strip = ({ updated_at, ...rest }) => rest;
    return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

// reconcileOpenOrderRealtime — surgical in-place merge of a realtime open_orders
// change into store.openOrders, replacing the old full-list reload that reset
// scroll/focus on every cell edit. The open_orders table holds only active rows
// (shipped/deleted rows move to open_orders_completed), so every row belongs —
// no status predicate needed; the view computeds handle section ordering.
// Input: realtime payload { eventType, new: row, old }. No return value.
export function reconcileOpenOrderRealtime({ eventType, new: row, old }) {
    const list = store.openOrders.value;
    if (eventType === 'DELETE') {
        const id = old?.id;
        if (id != null) store.openOrders.value = list.filter(o => o.id !== id);
        return;
    }
    if (!row) return;
    const idx = list.findIndex(o => o.id === row.id);
    if (idx === -1) {
        store.openOrders.value = [...list, row];
        return;
    }
    // Stale-echo guard: rapid successive writes to one row (e.g. a chute boxed
    // via both the Chute + Bracket halves) each echo back; if the earlier
    // write's echo lands last it would overwrite the newer local state (dropping
    // the row off the Boxed tab until a refresh). Drop any echo strictly older
    // than the row already in memory. Compare epoch ms, not strings — the DB and
    // client stamp updated_at in different ISO formats.
    const incomingT = new Date(row.updated_at).getTime();
    const currentT  = new Date(list[idx].updated_at).getTime();
    if (Number.isFinite(incomingT) && Number.isFinite(currentT) && incomingT < currentT) return;
    if (_openOrderRowsEqualIgnoringVolatile(list[idx], row)) return; // self-echo, no-op
    const next = [...list];
    next[idx]  = row;
    store.openOrders.value = next;
}
