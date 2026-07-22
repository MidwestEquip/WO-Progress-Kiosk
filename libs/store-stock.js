// ============================================================
// libs/store-stock.js — Stock / native-ledger reactive state
//
// Sub-file of store.js (re-exported there; created because
// store-inventory.js was at its 500-line cap). Rules: ref()/computed()
// only — no fetch calls, no DB access. Imports woRequestDetailForm from
// store-inventory.js — a one-way sibling edge, same pattern as
// store-open-orders.js; store-inventory.js must never import this file.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { woRequestDetailForm } from './store-inventory.js';

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

// ── Pipeline / WIP panel (WO Request data section) ────────────
// Bucketed output of utils.bucketPartWip, loaded per modal open by
// wo-request-detail.js. Everything in flight for this part that has NOT
// reached part_on_hand yet (the ledger only emits at closeout):
// { requested, inProduction, completedNotReceived, receivedNotClosed, total }.
export const woRequestWip        = ref(null);
export const woRequestWipLoading = ref(false);

// woRequestPipelineQty — the single number the Suggested Qty math subtracts.
// 0 until loaded, so the suggestion is never inflated by a pending fetch.
export const woRequestPipelineQty = computed(() => woRequestWip.value?.total || 0);

// woRequestWipHasAny — true when any stage has qty; drives the empty state.
export const woRequestWipHasAny = computed(() => woRequestPipelineQty.value > 0);

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

// ── WO Request derived numbers (moved here from store-inventory.js,
// which was over the 500-line cap). They live beside the pipeline state
// they consume. Source of the form fields: store-inventory.js.
// ──────────────────────────────────────────────────────────────

// woRequestEstQtyInStock — estimated parts on hand or embedded in assemblies.
// Formula: qty_used_in_mfg − (direct_sold + parent_demand) + qty_made
// Returns null when all inputs are zero (nothing to show yet).
export const woRequestEstQtyInStock = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_used_12mo)           || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_period) || 0;
    const mfg    = parseFloat(form.qty_used_in_mfg)              || 0;
    const made   = parseFloat(form.qty_made_past_12mo)           || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && made === 0) return null;
    return mfg - (sold + parent) + (made - mfg);
});

// woRequestSuggestedQty — how many to make: total demand minus est. stock
// minus what is already in the pipeline, + 5%.
// Hidden when demand is zero or stock + pipeline already covers demand.
export const woRequestSuggestedQty = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_used_12mo)           || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_period) || 0;
    const est    = woRequestEstQtyInStock.value;
    const total  = sold + parent;
    if (total === 0 || est === null) return null;
    // Pipeline = in flight but not yet in stock; 0 until it loads, so a
    // pending fetch can only over-suggest, never under-suggest.
    const needed = total - Math.max(est, 0) - woRequestPipelineQty.value;
    if (needed <= 0) return null;
    return Math.ceil(needed * 1.05);
});

// woRequestEstQtyInStock36mo — same formula as 1yr but using 3yr fields.
export const woRequestEstQtyInStock36mo = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_36mo)               || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_36mo)  || 0;
    const mfg    = parseFloat(form.qty_used_in_mfg_36mo)        || 0;
    const made   = parseFloat(form.qty_made_36mo)               || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && made === 0) return null;
    return mfg - (sold + parent) + (made - mfg);
});

// woRequestSuggestedQty36mo — 3yr demand minus est. stock minus pipeline, + 5%.
export const woRequestSuggestedQty36mo = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_36mo)               || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_36mo)  || 0;
    const est    = woRequestEstQtyInStock36mo.value;
    const total  = sold + parent;
    if (total === 0 || est === null) return null;
    const yearlyDemand = total / 3; // make a 1-year supply, not 3 years
    const needed = yearlyDemand - Math.max(est, 0) - woRequestPipelineQty.value;
    if (needed <= 0) return null;
    return Math.ceil(needed * 1.05);
});
