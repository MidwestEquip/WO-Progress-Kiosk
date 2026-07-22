// ============================================================
// open-orders-wo-sync.js — WO request/approval → Open Orders board sync
// ============================================================
// One shared helper for both wo-request-view.js (status → 'WO Requested') and
// wo-manager-approval.js (status → 'WO Created' + job #). Matching is by PART #
// only — the sales order number is deliberately ignored, so a WO raised without
// an SO# still moves the board, and a WO for a part on several open orders moves
// all of them. Rows in OPEN_ORDER_WO_SYNC_SKIP_STATUSES are left alone.
//
// Same shape as _syncOpenOrderForPo in purchasing-receive.js (the purchasing-side
// equivalent), including the page→page import it is consumed by.

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { buildOpenOrderWoSyncUpdates } from '../libs/utils.js';
import { OPEN_ORDER_WO_SYNC_SKIP_STATUSES } from '../libs/config.js';

// syncOpenOrdersForWoPart — stamp a WO status onto every eligible open order for a
// part. Non-fatal by contract: the caller's WO row is already written, so a board
// failure toasts and logs rather than throwing.
// Inputs: partNumber; opts { status, woPoNumber, deadline, skipExtra, label }.
//   woPoNumber — written only into rows whose WO/PO cell is blank.
//   deadline   — YYYY-MM-DD applied to every updated row (null to leave alone).
//   skipExtra  — extra statuses to skip on top of the shared list.
//   label      — used in the failure toast ('Request submitted' / 'WO approved').
// Output: number of rows updated (0 on any failure).
export async function syncOpenOrdersForWoPart(partNumber, {
    status, woPoNumber = null, deadline = null, skipExtra = [], label = 'Saved',
} = {}) {
    const part = (partNumber || '').trim().toUpperCase();
    if (!part || !status) return 0;

    try {
        const { data: rows, error } = await db.findOpenOrdersByPartForWoSync(part);
        if (error) throw error;
        if (!rows.length) return 0;

        const skipStatuses = [...OPEN_ORDER_WO_SYNC_SKIP_STATUSES, ...skipExtra];
        const nowIso = new Date().toISOString();
        let updated = 0;

        for (const row of rows) {
            const u = buildOpenOrderWoSyncUpdates(row, {
                status, woPoNumber, deadline, nowIso, skipStatuses,
            });
            if (!u) continue;
            const { error: rowErr } = await db.updateOpenOrder(row.id, u);
            if (rowErr) throw rowErr;
            updated++;
        }
        return updated;
    } catch (e) {
        store.showToast(`${label}, but the open order board did not update: ${e.message}`, 'error', 7000);
        logError('syncOpenOrdersForWoPart', e, { part, status });
        return 0;
    }
}
