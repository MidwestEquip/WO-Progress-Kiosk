// ============================================================
// libs/store-stock.js — Stock / native-ledger reactive state
//
// Sub-file of store.js (re-exported there; store-inventory.js is at
// its 500-line cap). Rules: ref()/computed() only — no fetch calls,
// no DB access.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// woRequestDetailGen — monotonic open-generation counter for the WO Request
// detail modal. openWoRequestDetail (wo-request-detail.js) captures it; every
// fire-and-forget load checks it before writing, so a newer open (or a
// subpart drill-in/restore, wo-request-subparts.js) cancels stale writes.
// Lives in the store because both page files read/bump it (pages never
// import each other). Plain counter — nothing binds to it in templates.
export const woRequestDetailGen = ref(0);

// ── Live on-hand panel (WO Request data section) ──────────────
// Loaded per modal open by wo-request-detail.js; cleared on each open.
// woRequestOnHand:  { on_hand, counted_at } for the requested part, or null.
//                   counted_at null = never physically counted → shown as '—'.
// woRequestOnUnits: { qty, counted, total } — qty of this part already built
//                   into BOM ancestors still in stock (counted ancestors only);
//                   counted/total = how many ancestors have a physical count.
export const woRequestOnHand        = ref(null);
export const woRequestOnUnits      = ref(null);
export const woRequestOnHandLoading = ref(false);

// woRequestOnHandDisplay — the number for the "In Stock (Software)" cell.
// null (→ '—') until the part has a physical count anchoring its on-hand.
export const woRequestOnHandDisplay = computed(() => {
    const oh = woRequestOnHand.value;
    return (oh && oh.counted_at != null) ? oh.on_hand : null;
});

// woRequestOnHandSubLabel — detail line under the cell: on-units, total, and
// last-count date. Examples: '+24 on units · 36 total · counted 7/17/2026'
// or 'not counted yet · +8 on units (2/5 counted)'. Empty until data loads.
export const woRequestOnHandSubLabel = computed(() => {
    const oh = woRequestOnHand.value;
    const ou = woRequestOnUnits.value;
    if (!oh && !ou) return '';
    const counted = !!(oh && oh.counted_at != null);
    const parts = [];
    if (!counted) parts.push('not counted yet');
    if (ou && ou.total > 0) {
        let s = `+${ou.qty} on units`;
        if (ou.counted < ou.total) s += ` (${ou.counted}/${ou.total} counted)`;
        parts.push(s);
        if (counted) parts.push(`${oh.on_hand + ou.qty} total`);
    }
    if (counted) parts.push('counted ' + new Date(oh.counted_at).toLocaleDateString());
    return parts.join(' · ');
});
