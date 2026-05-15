// ============================================================
// libs/store-purchasing.js — Purchasing reactive state
//
// Re-exported by store.js. No fetch calls here.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// Active tab: 'parts' | 'supplies' | 'steel' | 'completed'
export const purchasingTab     = ref('parts');
export const purchasingOrders  = ref([]);
export const purchasingLoading = ref(false);

const DONE_STATUSES = ['received', 'canceled'];

// filteredPurchasingOrders — active orders scoped to the current ordering tab.
// 'completed' is loaded separately in a later patch.
export const filteredPurchasingOrders = computed(() => {
    const tab    = purchasingTab.value;
    const orders = purchasingOrders.value;
    if (tab === 'completed') return [];
    const open = orders.filter(o => !DONE_STATUSES.includes(o.status));
    if (tab === 'parts')    return open.filter(o => o.request_type === 'part');
    if (tab === 'supplies') return open.filter(o => o.request_type === 'supply');
    if (tab === 'steel')    return open.filter(o => o.request_type === 'steel');
    return open;
});

// ── New request form ──────────────────────────────────────────

export const purchasingRequestModalOpen  = ref(false);
export const purchasingRequestSaving     = ref(false);
export const purchasingRequestFormErrors = ref({});

export const purchasingRequestForm = ref({
    request_type:           '',
    requested_by:           '',
    needed_by:              '',
    qty_needed:             '',
    requester_notes:        '',
    // Part
    part_number:            '',
    description:            '',
    sales_order:            '',
    wo_number:              '',
    job_number:             '',
    estimated_qty_in_stock: '',
    request_location:       '',
    bin_location:           '',
    // Supply
    supply_item_name:       '',
    supply_category:        '',
    // Steel
    material_type:          '',
    material_size:          '',
    material_thickness:     '',
    material_length:        '',
    material_grade:         '',
    steel_shape:            '',
});

// ── Completed tab ─────────────────────────────────────────────

export const purchasingCompletedOrders  = ref([]);
export const purchasingCompletedLoading = ref(false);
export const purchasingCompletedFrom    = ref('');
export const purchasingCompletedTo      = ref('');

// ── Detail / edit modal ───────────────────────────────────────

export const purchasingDetailOpen    = ref(false);
export const purchasingDetailOrder   = ref(null);
export const purchasingDetailSection = ref('ordering'); // 'ordering' | 'receiving'
export const purchasingDetailSaving  = ref(false);
export const purchasingReceiveSaving = ref(false);

export const purchasingDetailForm = ref({
    status:               '',
    supplier_name:        '',
    supplier_part_number: '',
    po_number:            '',
    estimated_lead_time:  '',
    expected_date:        '',
    qty_ordered:          '',
    purchaser_notes:      '',
    purchaser_questions:  '',
    production_notes:     '',
});

export const purchasingReceiveForm = ref({
    qty_received: '',
    received_by:  '',
});

export const purchasingDetailEvents        = ref([]);
export const purchasingDetailEventsLoading = ref(false);

// ── Quotes tab ────────────────────────────────────────────────
export const purchasingDetailQuotes        = ref([]);
export const purchasingDetailQuotesLoading = ref(false);

// ── Quote builder ─────────────────────────────────────────────
export const quoteBuilderOpen            = ref(false);
export const quoteBuilderSaving          = ref(false);
export const quoteBuilderSelectedOrders  = ref([]);  // array of order objects
export const quoteBuilderItems           = ref({});  // { [orderId]: { qty, price, lead_time } }
export const quoteBuilderForm            = ref({ supplier_name: '', quote_ref: '', terms: '', shipping_price: '' });

// ── All Quotes tab ────────────────────────────────────────────
export const allQuotes         = ref([]);
export const allQuotesLoading  = ref(false);
export const quoteOrderingId   = ref(null);   // quote.id currently showing PO# input
export const quoteOrderPoNum   = ref('');
export const quoteOrderSaving  = ref(false);

// ── Part usage (Request Info tab, parts only) ─────────────────
export const purchasingPartUsage              = ref(null); // { qty_sold, qty_used_mfg, qty_made, qty_purchased_12mo, recent_purchases }
export const purchasingPartUsageLoading       = ref(false);
export const purchasingPartParentUsage        = ref(null); // numeric totalDemand
export const purchasingPartParentUsageLoading = ref(false);
export const purchasingPartPurchaseHistory        = ref([]); // enriched last-2 purchases with supplier info
export const purchasingPartPurchaseHistoryLoading = ref(false);
export const purchasingPartPurchaseHistoryError   = ref(false);

// purchasingPartEstQtyInStock — formula mirrors woRequestEstQtyInStock in store-inventory.js.
export const purchasingPartEstQtyInStock = computed(() => {
    const u = purchasingPartUsage.value;
    if (!u) return null;
    const sold      = u.qty_sold           || 0;
    const parent    = purchasingPartParentUsage.value || 0;
    const mfg       = u.qty_used_mfg       || 0;
    const purchased = u.qty_purchased_12mo || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && purchased === 0) return null;
    return mfg - (sold + parent) + (purchased - mfg);
});

// purchasingPartSuggestedQty — total demand minus est. stock, + 5%.
export const purchasingPartSuggestedQty = computed(() => {
    const u = purchasingPartUsage.value;
    if (!u) return null;
    const total  = (u.qty_sold || 0) + (purchasingPartParentUsage.value || 0);
    const est    = purchasingPartEstQtyInStock.value;
    if (total === 0 || est === null) return null;
    const needed = total - est;
    return needed <= 0 ? null : Math.ceil(needed * 1.05);
});

// purchasingTabCounts — open order counts per ordering tab for badge display.
export const purchasingTabCounts = computed(() => {
    const open = purchasingOrders.value.filter(o => !DONE_STATUSES.includes(o.status));
    return {
        parts:    open.filter(o => o.request_type === 'part').length,
        supplies: open.filter(o => o.request_type === 'supply').length,
        steel:    open.filter(o => o.request_type === 'steel').length,
    };
});
