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
import { woRequestDetailForm, woRequestSubpartMode } from './store-inventory.js';

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

// ── Data-section layout (WO Request detail modal) ─────────────
// woRequestDataGridClass — the history grids share the left column with the
// Subparts panel when one is shown ('weld' / 'assy' — same condition as the
// panel's own v-if in modal-wo-request-subparts.html). In that squeezed state
// the cells switch to a fixed narrow width: labels wrap to two lines (reserved
// via min-h so every bubble in a row still lines up) and each bubble is only as
// wide as its title. With no subparts panel the column has room for the roomier
// 6-up grid. One class string so the template stays logic-free.
export const woRequestDataGridClass = computed(() => {
    const squeezed = woRequestSubpartMode.value === 'weld'
                  || woRequestSubpartMode.value === 'assy';
    return squeezed
        ? 'flex flex-wrap gap-1.5 [&>div]:w-[5.5rem] [&>div.col-span-2]:w-[11.5rem] '
          + '[&_label]:leading-tight [&_label]:min-h-[2.1rem]'
        : 'grid grid-cols-6 gap-1.5';
});

// ── On-order panel (WO Request data section) ──────────────────
// Qty still owed on the live Open Orders board, loaded per modal open by
// wo-request-detail.js (statuses limited to OPEN_ORDER_DEMAND_STATUSES).
// woRequestOnOrder:        sum of To Ship on rows for THIS part #.
// woRequestOnOrderParents: qty of this part those orders will consume via BOM
//                          ancestors on the board — parent To Ship × the
//                          accumulated qty-per-assy up each BOM path.
// Both null until the fetch lands (shown as '…'), then a number (0 = nothing).
export const woRequestOnOrder        = ref(null);
export const woRequestOnOrderParents = ref(null);
export const woRequestOnOrderLoading = ref(false);

// woRequestOnOrderTotal — the two cells combined; null while either is pending
// so a half-loaded total is never shown as authoritative.
export const woRequestOnOrderTotal = computed(() => {
    if (woRequestOnOrder.value == null || woRequestOnOrderParents.value == null) return null;
    return woRequestOnOrder.value + woRequestOnOrderParents.value;
});

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
// The EFFECTIVE on-hand (estimate baseline + deltas, or count + deltas);
// null (→ '—') only when the part has no ledger row at all.
export const woRequestOnHandDisplay = computed(() => {
    const oh = woRequestOnHand.value;
    return (oh && oh.on_hand != null) ? oh.on_hand : null;
});

// woRequestOnHandBasis — 'count' | 'estimate' | null (no data). Drives the
// cell tone and the counted/estimated tag. Derived from counted_at so it
// works whether or not the map entry carried an explicit basis field.
export const woRequestOnHandBasis = computed(() => {
    const oh = woRequestOnHand.value;
    if (!oh || oh.on_hand == null) return null;
    return oh.counted_at != null ? 'count' : 'estimate';
});

// woRequestOnHandToneClass — border/bg/text classes for the cell, by basis.
// A computed (not an inline template ternary) per the >1-ternary rule.
export const woRequestOnHandToneClass = computed(() => {
    switch (woRequestOnHandBasis.value) {
        case 'count':    return 'border-sky-300 bg-sky-50 text-sky-800';
        case 'estimate': return 'border-amber-300 bg-amber-50 text-amber-800';
        default:         return 'border-gray-200 text-gray-400';
    }
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
    if (!counted) parts.push('estimated');
    if (ou && ou.total > 0) {
        let s = `+${ou.qty} on units`;
        if (ou.counted < ou.total) s += ` (${ou.counted}/${ou.total} counted)`;
        parts.push(s);
        if (counted) parts.push(`${oh.on_hand + ou.qty} total`);
    }
    if (counted) parts.push('counted ' + new Date(oh.counted_at).toLocaleDateString());
    return parts.join(' · ');
});

// woRequestOnHandFormula — { text, title } showing HOW the In Stock (Software)
// number was reached, so it can be compared against Est. Qty in Stock (which
// uses a completely different method — history arithmetic, not the ledger).
// Counted parts: the count is the anchor and the stored number already folds in
// every move since, so the split is not recoverable — say so rather than invent
// one. Uncounted parts: effective = max(0, baseline) + deltas, so the delta is
// derivable. null when nothing has loaded.
export const woRequestOnHandFormula = computed(() => {
    const oh = woRequestOnHand.value;
    if (!oh || oh.on_hand == null) return null;
    if (oh.counted_at != null) {
        const d = new Date(oh.counted_at).toLocaleDateString();
        return {
            text:  `From hard count (${d}) + moves since`,
            title: `Anchored to a physical count entered on ${d}. Every native `
                 + `ledger move since is applied to it (WO closeouts in; ships `
                 + `and PO receipts out). No estimating involved.`,
        };
    }
    return {
        text:  'From estimate: Made + Purchased − Used in MFG − Sold, + moves since',
        title: 'Never physically counted. The starting number is a frozen '
             + 'estimate from ALL Alere history before cutover: Made + Purchased '
             + '− Used in MFG − Sold (floored at 0). Every native ledger move '
             + 'since cutover is added to it. Enter a physical count to replace '
             + 'the estimate with a hard anchor.',
    };
});

// _EST_FORMULA — the Est. Qty in Stock cells (1yr and 3yr) run the same formula
// over different fields, so the displayed formula is the same string. Mirrors
// woRequestEstQtyInStock exactly: Qty Used in MFG is NOT a term in it.
const _EST_FORMULA = {
    text:  'Made + Purchased − Sold − Sold of Used On',
    title: 'Qty Made + Qty Purchased − Qty Sold − Qty Sold of Used On, over this '
         + 'window only. It has no idea what was on the shelf before the window '
         + 'opened, so a long-standing part reads low or negative.',
};

// ── WO Request derived numbers (moved here from store-inventory.js,
// which was over the 500-line cap). They live beside the pipeline state
// they consume. Source of the form fields: store-inventory.js.
// ──────────────────────────────────────────────────────────────

// woRequestEstQtyInStock — estimated parts on hand or embedded in assemblies.
// Formula: (qty_made + qty_purchased) − (direct_sold + parent_demand).
// Purchased was previously omitted, so purchased parts read low/negative.
// Returns null when all inputs are zero (nothing to show yet).
export const woRequestEstQtyInStock = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_used_12mo)           || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_period) || 0;
    const mfg    = parseFloat(form.qty_used_in_mfg)              || 0;
    const made   = parseFloat(form.qty_made_past_12mo)           || 0;
    const purch  = parseFloat(form.qty_purchased_12mo)           || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && made === 0 && purch === 0) return null;
    return made + purch - (sold + parent);
});

// woRequestEstQtyInStockFormula — { text, title } under the 1yr cell. null when
// the number itself is null (nothing to explain yet).
export const woRequestEstQtyInStockFormula = computed(() =>
    woRequestEstQtyInStock.value === null ? null : _EST_FORMULA);

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
    const purch  = parseFloat(form.qty_purchased_36mo)          || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && made === 0 && purch === 0) return null;
    return made + purch - (sold + parent);
});

// woRequestEstQtyInStockFormula36mo — same, under the 3yr cell.
export const woRequestEstQtyInStockFormula36mo = computed(() =>
    woRequestEstQtyInStock36mo.value === null ? null : _EST_FORMULA);

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
