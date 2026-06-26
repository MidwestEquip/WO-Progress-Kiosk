// ============================================================
// libs/store-purchasing.js — Purchasing reactive state
//
// Re-exported by store.js. No fetch calls here.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { STEEL_LOCATIONS } from './config.js';
import { normalizePartNumberStrict } from './utils.js';

// Active tab: 'parts' | 'supplies' | 'steel' | 'completed'
export const purchasingTab     = ref('parts');
export const purchasingOrders  = ref([]);
// Normalized part keys that appear on MORE THAN ONE active part order in the ordering queue
// (requested/quoting/quoted/approved/not_approved). Used to red-flag duplicate part rows.
export const duplicatePoPartKeys = computed(() => {
    const counts = {};
    for (const o of purchasingOrders.value) {
        if (o.request_type !== 'part') continue;
        const k = normalizePartNumberStrict(o.part_number || '');
        if (!k) continue;
        counts[k] = (counts[k] || 0) + 1;
    }
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
});
export const purchasingLoading = ref(false);

const DONE_STATUSES = ['received', 'canceled', 'ordered', 'partially_received'];

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

// steelOrdersByLocation — open steel orders grouped by ship_to, in STEEL_LOCATIONS order.
// Sections with no orders are omitted. Unrecognised ship_to values land in "Other".
export const steelOrdersByLocation = computed(() => {
    const open = purchasingOrders.value.filter(
        o => o.request_type === 'steel' && !DONE_STATUSES.includes(o.status)
    );
    const map = {};
    open.forEach(o => {
        const loc = STEEL_LOCATIONS.includes(o.ship_to) ? o.ship_to : 'Other';
        if (!map[loc]) map[loc] = [];
        map[loc].push(o);
    });
    const result = STEEL_LOCATIONS
        .filter(loc => map[loc])
        .map(loc => ({ location: loc, orders: map[loc] }));
    if (map['Other']) result.push({ location: 'Other', orders: map['Other'] });
    return result;
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
    material_type:          'Carbon',
    steel_shape:            '',
    material_description:   '',
    material_length:        '',
});

// Active-PO warning for the New PO Request form. { part, items } — part = normalized part
// the items were fetched for, so a stale banner never shows for a different/blank part.
export const purchasingRequestActivePos = ref({ part: '', items: [] });
export const purchasingRequestActivePoItems = computed(() => {
    const a   = purchasingRequestActivePos.value;
    const cur = (purchasingRequestForm.value.part_number || '').trim().toUpperCase();
    return (a.part && a.part === cur) ? a.items : [];
});

// ── Completed tab ─────────────────────────────────────────────

export const purchasingCompletedOrders  = ref([]);
export const purchasingCompletedLoading = ref(false);
export const purchasingCompletedFrom    = ref('');
export const purchasingCompletedTo      = ref('');

// ── Detail / edit modal ───────────────────────────────────────

export const purchasingDetailOpen      = ref(false);
export const purchasingDetailOrder     = ref(null);
// poDetailRealCount — manual item_master count for the open PO's part, or null.
// { qty, date } populated (non-blocking) when the Research tab is opened for a part order.
export const poDetailRealCount = ref(null);
// poDetailRealCountLabel — Research-tab display string ("N (YYYY-MM-DD)"), or '' when none.
export const poDetailRealCountLabel = computed(() => {
    const rc = poDetailRealCount.value;
    if (!rc || rc.qty == null) return '';
    return rc.date ? `${rc.qty} (${rc.date})` : `${rc.qty}`;
});
export const purchasingDetailSection   = ref('ordering'); // 'ordering' | 'receiving'
export const purchasingDetailSaving    = ref(false);
export const purchasingDetailAutoSaved = ref(false); // true briefly after each autosave
export const purchasingReceiveSaving   = ref(false);

export const purchasingDetailForm = ref({
    status:               '',
    supplier_name:        '',
    supplier_part_number: '',
    po_number:            '',
    date_ordered:         '',
    estimated_lead_time:  '',
    expected_date:        '',
    qty_ordered:          '',
    cost:                 '',
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

// ── Order attachments (Quoting tab) ──────────────────────────
export const orderAttachments          = ref([]);  // [{ name, path, signedUrl }]
export const orderAttachmentsLoading   = ref(false);
export const orderAttachmentsUploading = ref(false);

// ── Quote builder ─────────────────────────────────────────────
export const quoteBuilderOpen            = ref(false);
export const quoteBuilderSaving          = ref(false);
export const quoteBuilderSelectedOrders  = ref([]);  // array of order objects
export const quoteBuilderItems           = ref({});  // { [orderId]: { qty, price, lead_time } }
export const quoteBuilderForm            = ref({ supplier_name: '', quote_ref: '', terms: '', shipping_price: '' });
export const quoteBuilderPendingFiles    = ref([]);  // [File] staged before save

// ── All Quotes tab ────────────────────────────────────────────
export const allQuotes         = ref([]);
export const allQuotesLoading  = ref(false);
export const quoteOrderingId   = ref(null);   // quote.id currently showing PO# input
export const quoteOrderPoNum   = ref('');
export const quoteOrderSaving  = ref(false);

// ── Part usage (Research tab, parts only) ─────────────────────

// 1-year data
export const purchasingPartUsage              = ref(null); // { qty_sold, qty_used_mfg, qty_made, qty_purchased_12mo }
export const purchasingPartUsageLoading       = ref(false);
export const purchasingPartParentUsage        = ref(null); // numeric totalDemand (1yr BOM period)
export const purchasingPartParentUsageLoading = ref(false);
export const purchasingPartPurchaseHistory        = ref([]); // enriched last-3 purchases with supplier info
export const purchasingPartPurchaseHistoryLoading = ref(false);
export const purchasingPartPurchaseHistoryError   = ref(false);

// 3-year data
export const purchasingPartUsage36mo              = ref(null); // { qty_sold, qty_used_mfg, qty_made, qty_purchased_36mo }
export const purchasingPartUsageLoading36mo       = ref(false);
export const purchasingPartParentUsage36mo        = ref(null); // numeric totalDemand (36mo rolling)
export const purchasingPartParentUsageLoading36mo = ref(false);

// purchasingPartEstQtyInStock — 1yr formula.
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

// purchasingPartSuggestedQty — 1yr total demand minus est. stock, + 5%.
export const purchasingPartSuggestedQty = computed(() => {
    const u = purchasingPartUsage.value;
    if (!u) return null;
    const total  = (u.qty_sold || 0) + (purchasingPartParentUsage.value || 0);
    const est    = purchasingPartEstQtyInStock.value;
    if (total === 0 || est === null) return null;
    const needed = total - Math.max(est, 0); // negative stock counts as 0
    return needed <= 0 ? null : Math.ceil(needed * 1.05);
});

// purchasingPartEstQtyInStock36mo — 3yr formula.
export const purchasingPartEstQtyInStock36mo = computed(() => {
    const u = purchasingPartUsage36mo.value;
    if (!u) return null;
    const sold      = u.qty_sold      || 0;
    const parent    = purchasingPartParentUsage36mo.value || 0;
    const mfg       = u.qty_used_mfg  || 0;
    const purchased = u.qty_purchased_36mo || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && purchased === 0) return null;
    return mfg - (sold + parent) + (purchased - mfg);
});

// purchasingPartSuggestedQty36mo — 3yr total demand minus est. stock, + 5%.
export const purchasingPartSuggestedQty36mo = computed(() => {
    const u = purchasingPartUsage36mo.value;
    if (!u) return null;
    const total  = (u.qty_sold || 0) + (purchasingPartParentUsage36mo.value || 0);
    const est    = purchasingPartEstQtyInStock36mo.value;
    if (total === 0 || est === null) return null;
    const yearlyDemand = total / 3; // make a 1-year supply, not 3 years
    const needed = yearlyDemand - Math.max(est, 0); // negative stock counts as 0
    return needed <= 0 ? null : Math.ceil(needed * 1.05);
});

// purchasingPartYearlyAvg36mo — Since-Jan-2023 totals divided by 3 (≈ per-year average).
// Returns { sold, parent, purchased, mfg }; each value is null when the source is blank.
export const purchasingPartYearlyAvg36mo = computed(() => {
    const u   = purchasingPartUsage36mo.value;
    const avg = (n) => (n == null || isNaN(n)) ? null : Math.round(n / 3);
    return {
        sold:      avg(u ? u.qty_sold : null),
        parent:    avg(purchasingPartParentUsage36mo.value),
        purchased: avg(u ? u.qty_purchased_36mo : null),
        mfg:       avg(u ? u.qty_used_mfg : null),
    };
});

// purchasingTabCounts — open order counts per ordering tab for badge display.
export const purchasingTabCounts = computed(() => {
    const open = purchasingOrders.value.filter(o => !DONE_STATUSES.includes(o.status));
    return {
        parts:    open.filter(o => o.request_type === 'part').length,
        supplies: open.filter(o => o.request_type === 'supply').length,
        steel:    open.filter(o => o.request_type === 'steel').length,
        approval: purchasingOrders.value.filter(o => o.status === 'quoted').length,
    };
});

// approvalOrders — orders waiting for manager approval (status = 'quoted').
export const approvalOrders = computed(() =>
    purchasingOrders.value.filter(o => o.status === 'quoted')
);

// partOrdersByLocation — open part orders grouped by ship_to in STEEL_LOCATIONS order.
export const partOrdersByLocation = computed(() => {
    const open = purchasingOrders.value.filter(
        o => o.request_type === 'part' && !DONE_STATUSES.includes(o.status)
    );
    const map = {};
    open.forEach(o => {
        const loc = STEEL_LOCATIONS.includes(o.ship_to) ? o.ship_to : 'Other';
        if (!map[loc]) map[loc] = [];
        map[loc].push(o);
    });
    const result = STEEL_LOCATIONS.filter(loc => map[loc]).map(loc => ({ location: loc, orders: map[loc] }));
    if (map['Other']) result.push({ location: 'Other', orders: map['Other'] });
    return result;
});

// supplyOrdersByLocation — open supply orders grouped by ship_to in STEEL_LOCATIONS order.
export const supplyOrdersByLocation = computed(() => {
    const open = purchasingOrders.value.filter(
        o => o.request_type === 'supply' && !DONE_STATUSES.includes(o.status)
    );
    const map = {};
    open.forEach(o => {
        const loc = STEEL_LOCATIONS.includes(o.ship_to) ? o.ship_to : 'Other';
        if (!map[loc]) map[loc] = [];
        map[loc].push(o);
    });
    const result = STEEL_LOCATIONS.filter(loc => map[loc]).map(loc => ({ location: loc, orders: map[loc] }));
    if (map['Other']) result.push({ location: 'Other', orders: map['Other'] });
    return result;
});

// poForecastOrdersByLocation — forecasted orders grouped by ship_to in STEEL_LOCATIONS order.
export const poForecastOrdersByLocation = computed(() => {
    const map = {};
    poForecastOrders.value.forEach(o => {
        const loc = STEEL_LOCATIONS.includes(o.ship_to) ? o.ship_to : 'Other';
        if (!map[loc]) map[loc] = [];
        map[loc].push(o);
    });
    const result = STEEL_LOCATIONS.filter(loc => map[loc]).map(loc => ({ location: loc, orders: map[loc] }));
    if (map['Other']) result.push({ location: 'Other', orders: map['Other'] });
    return result;
});

// approvalOrdersByLocation — quoted orders grouped by ship_to in STEEL_LOCATIONS order.
export const approvalOrdersByLocation = computed(() => {
    const quoted = purchasingOrders.value.filter(o => o.status === 'quoted');
    const map = {};
    quoted.forEach(o => {
        const loc = STEEL_LOCATIONS.includes(o.ship_to) ? o.ship_to : 'Other';
        if (!map[loc]) map[loc] = [];
        map[loc].push(o);
    });
    const result = STEEL_LOCATIONS
        .filter(loc => map[loc])
        .map(loc => ({ location: loc, orders: map[loc] }));
    if (map['Other']) result.push({ location: 'Other', orders: map['Other'] });
    return result;
});

// steelStatusPickerOpen — orderId whose inline status picker is open, or null.
export const steelStatusPickerOpen = ref(null);

// steelOrderPanelOpen — orderId with the "confirm order" detail panel expanded, or null.
export const steelOrderPanelOpen  = ref(null);
export const steelOrderSaving     = ref(false);
export const steelOrderErrors     = ref({});
export const steelOrderForm       = ref({
    supplier_name:       '',
    po_number:           '',
    date_ordered:        '',
    cost:                '',
    qty_ordered:         '',
    estimated_lead_time: '',
});

// ── Approval view ─────────────────────────────────────────────

export const approvalManagerAuthed = ref(false);
export const approvalPinInput      = ref('');
export const approvalPinError      = ref(false);
export const approvalReviseOpen    = ref(false);
export const approvalReviseNote    = ref('');

// ── PO Receive (Inventory view) ───────────────────────────────

export const poReceiveOrders  = ref([]);
export const poReceiveLoading = ref(false);
export const poReceiveTab     = ref('part'); // 'part' | 'supply' | 'steel'
export const poReceiveOpen    = ref(false);
export const poReceiveItem    = ref(null);
export const poReceiveSaving  = ref(false);
export const poReceiveForm    = ref({ qty_received: '', received_by: '' });

export const poReceiveSearch = ref('');

// filteredPoReceiveOrders — pending orders for the active sub-tab, filtered by search.
export const filteredPoReceiveOrders = computed(() => {
    const q = poReceiveSearch.value.trim().toLowerCase();
    return poReceiveOrders.value
        .filter(o => o.request_type === poReceiveTab.value)
        .filter(o => !q ||
            (o.part_number       || '').toLowerCase().includes(q) ||
            (o.supply_item_name  || '').toLowerCase().includes(q) ||
            (o.material_type     || '').toLowerCase().includes(q) ||
            (o.description       || '').toLowerCase().includes(q) ||
            (o.supplier_name     || '').toLowerCase().includes(q) ||
            (o.po_number         || '').toLowerCase().includes(q)
        );
});

// poReceiveCounts — badge counts per type for PO Receive sub-tabs.
export const poReceiveCounts = computed(() => ({
    part:   poReceiveOrders.value.filter(o => o.request_type === 'part').length,
    supply: poReceiveOrders.value.filter(o => o.request_type === 'supply').length,
    steel:  poReceiveOrders.value.filter(o => o.request_type === 'steel').length,
}));

// ── PO Already Received ───────────────────────────────────────

export const poReceivedOrders       = ref([]);
export const poReceivedLoading      = ref(false);
export const poReceiveShowReceived  = ref(false); // toggles pending vs. received sub-view

// filteredPoReceivedOrders — received orders for the active sub-tab.
export const filteredPoReceivedOrders = computed(() =>
    poReceivedOrders.value.filter(o => o.request_type === poReceiveTab.value)
);

// poReceivedCounts — badge counts per type for the received panel.
export const poReceivedCounts = computed(() => ({
    part:   poReceivedOrders.value.filter(o => o.request_type === 'part').length,
    supply: poReceivedOrders.value.filter(o => o.request_type === 'supply').length,
    steel:  poReceivedOrders.value.filter(o => o.request_type === 'steel').length,
}));

// ── RFQ Email Drafter ─────────────────────────────────────────
export const rfqDraftOpen    = ref(false);
export const rfqDraftSubject = ref('');
export const rfqDraftText    = ref('');   // plain text shown in textarea
export const rfqDraftHtml    = ref('');   // HTML version copied to clipboard
export const rfqDraftCopied  = ref(false);
export const rfqDraftOrders  = ref([]);   // order objects included in this draft
export const rfqPickerOpen   = ref(false);
export const rfqPickerSearch = ref('');

// rfqPickerResults — open orders not yet in the current RFQ draft, filtered by search.
export const rfqPickerResults = computed(() => {
    const addedIds = new Set(rfqDraftOrders.value.map(o => o.id));
    const q = rfqPickerSearch.value.trim().toLowerCase();
    return purchasingOrders.value
        .filter(o => !DONE_STATUSES.includes(o.status) && !addedIds.has(o.id))
        .filter(o => !q ||
            (o.part_number      || '').toLowerCase().includes(q) ||
            (o.description      || '').toLowerCase().includes(q) ||
            (o.material_type    || '').toLowerCase().includes(q) ||
            (o.supply_item_name || '').toLowerCase().includes(q) ||
            (o.steel_shape      || '').toLowerCase().includes(q)
        );
});

// ── PO Forecasting ────────────────────────────────────────────

export const poForecastOrders    = ref([]);
export const poForecastLoading   = ref(false);
export const poForecastDeleteId  = ref(null);
export const poForecastMoveBackId = ref(null);

// Send-to-forecast confirmation dialog (opened from order detail modal)
export const poForecastSendOpen   = ref(false);
export const poForecastSendSaving = ref(false);
export const poForecastSendErrors = ref({});
export const poForecastSendForm   = ref({ revisit_date: '', reason: '' });

// ── Supplier catalog (Research tab: "all from this supplier") ─────────────────

export const supplierCatalogLoading = ref(false);
export const supplierCatalogParts   = ref([]);  // [{ part_number_normalized, description, total_qty, last_purchased }]
export const supplierCatalogCoid    = ref(null); // active company coid
export const supplierCatalogName    = ref('');   // active company display name
export const supplierCatalogSearch  = ref('');   // filter input
export const supplierCatalogChoices = ref([]);   // [{ poto, company_name }] — shown when multiple companies

// filteredSupplierCatalog — catalog rows matching the search term (part # or description).
export const filteredSupplierCatalog = computed(() => {
    const q = supplierCatalogSearch.value.trim().toLowerCase();
    if (!q) return supplierCatalogParts.value;
    return supplierCatalogParts.value.filter(r =>
        (r.part_number_normalized || '').toLowerCase().includes(q) ||
        (r.description            || '').toLowerCase().includes(q)
    );
});
