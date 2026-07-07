// ============================================================
// pages/purchasing-request-checks.js — New PO Request form checks
//
// Live "an active PO is already out for this part" warning. Kept in its own file so the
// over-cap pages/purchasing-view.js stays untouched. Imports store + db + config only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { PURCHASING_STATUS_LABELS } from './../libs/config.js';
import { normalizePartNumberStrict } from '../libs/utils.js';

// checkPoActiveOrders — on blur of the Part # field (Part type only), warn if an active
// (not received/canceled) PO already exists for this part. Fail-safe: no banner on error.
export async function checkPoActiveOrders() {
    const form = store.purchasingRequestForm.value;
    const part = (form.part_number || '').trim().toUpperCase();
    if (form.request_type !== 'part' || !part) {
        store.purchasingRequestActivePos.value = { part: '', items: [] };
        return;
    }
    const { data, error } = await db.fetchActivePosForPart(part);
    if (error) {
        store.purchasingRequestActivePos.value = { part: '', items: [] };
        return;
    }
    const items = (data || []).map(p => ({
        label:       p.po_number ? 'PO ' + p.po_number : 'PO request',
        detail:      PURCHASING_STATUS_LABELS[p.status] || p.status,
        qtyOrdered:  p.qty_ordered         ?? null,
        dateOrdered: p.date_ordered         ?? null,
        priceEach:   p.price_each           ?? null,
        leadTime:    p.estimated_lead_time  ?? null,
    }));
    store.purchasingRequestActivePos.value = { part, items };
}

// isPoPartDuplicated — true if this part appears on more than one active part order in the
// ordering queue. Returns a boolean (safe to bind per-row in the template). Dash/space-insensitive.
export function isPoPartDuplicated(partNumber) {
    const k = normalizePartNumberStrict(partNumber || '');
    return !!k && store.duplicatePoPartKeys.value.has(k);
}
