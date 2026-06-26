// ============================================================
// libs/store-inventory.js — CS, WO files, WO requests, inventory,
//                           open orders reactive state
//
// Re-exported by store.js. No imports from store.js.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── Customer Service ──────────────────────────────────────────
export const csSearchTerm  = ref('');
export const csResultInfo  = ref(null);
export const csTimeline    = ref([]);
export const csOpenOrders  = ref([]);
export const csPastSearch   = ref('');
export const csPastResults  = ref([]);
export const csPastSort     = ref('wo_number');
export const csPastSortDir  = ref('asc');
export const csPastSelected           = ref(null);
export const csUnitCompletions        = ref([]);
export const csUnitCompletionsLoading = ref(false);

// ── WO file attachments ───────────────────────────────────────
export const woFiles        = ref([]);
export const woFilesLoading = ref(false);
export const partsWithFiles = ref(new Set());

// ── WO Requests ───────────────────────────────────────────────
export const woRequestInlineState = ref({});
export const woRequests           = ref([]);
export const woRequestsLoading    = ref(false);
export const woRequestSoHint      = ref(null); // { salesOrder, qty, partNumber } or null
// Active-WO warning for the New Request form. { part, items } — part = normalized part
// the items were fetched for (so a stale banner never shows for a different/blank part).
export const woRequestActiveWos   = ref({ part: '', items: [] });
// Only surface the warning while it still matches what's typed (guards against a stale
// banner after the part field is edited but not yet re-blurred).
export const woRequestActiveWoItems = computed(() => {
    const a   = woRequestActiveWos.value;
    const cur = (woRequestForm.value.part_number || '').trim().toUpperCase();
    return (a.part && a.part === cur) ? a.items : [];
});
// Live active-WO warning shown inside the open detail modal (self-excluded). Array of
// { label, detail }. Re-checked each time the modal opens; cleared on close.
export const woRequestDetailActiveWos = ref([]);
export const woRequestForm        = ref({
    part_number: '', description: '', sales_order_number: '',
    qty_on_order: '', qty_in_stock: '', qty_used_per_unit: '',
    submitted_by: '', is_assembly: false
});
export const woRequestFormErrors = ref({ part_number: false, submitted_by: false });
export const woRequestSearch          = ref('');
export const selectedWoRequest        = ref(null);
export const woRequestReadOnly        = ref(false);
export const woRequestDefaultsApplied  = ref(false); // true when defaults were auto-filled on modal open
export const woRequestHistoryLoading       = ref(false); // true while fetching 1yr usage summary
export const woRequestParentUsageLoading   = ref(false); // true while calculating 1yr BOM parent demand
export const woRequestHistoryLoading36mo   = ref(false); // true while fetching 3yr usage summary
export const woRequestParentUsageLoading36mo = ref(false); // true while calculating 3yr BOM parent demand
export const woRequestLastMade             = ref([]);    // last 3 MO-I rows [{ txn_date, qty }]
// woRequestRealCount — manual item_master count for the selected request's part, or null.
// { qty, date } populated (non-blocking) when the detail modal opens (see openWoRequestDetail).
export const woRequestRealCount = ref(null);
// woRequestRealCountLabel — Data-panel display string ("N (YYYY-MM-DD)"), or '' when no count.
export const woRequestRealCountLabel = computed(() => {
    const rc = woRequestRealCount.value;
    if (!rc || rc.qty == null) return '';
    return rc.date ? `${rc.qty} (${rc.date})` : `${rc.qty}`;
});
export const woRequestUsedOn               = ref([]);    // BOM parents the requested part is used on: [{ part, qty, desc }] (qty = qty_per_assy)
export const woRequestUsedOnLoading        = ref(false); // true while fetching BOM parents
export const woRequestSubparts             = ref([]);    // BOM children [{ item_child, item_child_normalized, qty_per_assy }]
export const woRequestSubpartsLoading      = ref(false);
export const woRequestSubpartsExpanded     = ref(false);
export const woRequestSubpartBins          = ref({});   // { [part_normalized]: bin_location }
export const woRequestSubpartDescs         = ref({});   // { [part_normalized]: description }
export const woRequestSubpartForms         = ref({});   // { [part_normalized]: { expanded, defaultsLoaded, qty_to_make, routing... } }
export const woRequestSubpartStats        = ref({});   // { [part_normalized]: { made, sold, parent } }
// woRequestSubpartMode — determines which subparts panel variant to show based on routing fields.
// 'weld': weld_print=yes → full columns + WO creation; 'assy': assy WO → simplified;
// 'fab': fab only → hide panel; 'none': nothing selected yet → hide panel.
export const woRequestSubpartMode = computed(() => {
    const f = woRequestDetailForm.value;
    if ((f.weld_print || '').toLowerCase() === 'yes') return 'weld';
    if (f.assy_wo === 'Trac Vac Assy' || f.assy_wo === 'Tru Cut Assy') return 'assy';
    if ((f.fab || '').toLowerCase() === 'yes') return 'fab';
    return 'none';
});

export const woRequestSubpartEstHave = computed(() => {
    const map = {};
    for (const [n, s] of Object.entries(woRequestSubpartStats.value)) {
        if (s.made === 0 && s.sold === 0 && s.parent === 0) continue;
        map[n] = s.made - s.sold - s.parent;
    }
    return map;
});
export const woRequestDetailForm = ref({
    sales_order_number: '',
    alere_qty: '', qty_sold_used_12mo: '', qty_sold_parent_usage_period: '', where_used: '', qty_to_make: '',
    fab: '', fab_print: '', weld: '', weld_print: '',
    assy_wo: '', color: '', bent_rolled_part: '', set_up_time: '',
    alere_bin: '', estimated_lead_time: '', sent_to_production: false, date_to_start: '',
    production_notes: '', staging_area: '', status_notes: '', on_hold: false,
    // 3yr read-only reference data (not saved in approval snapshot)
    qty_sold_36mo: '', qty_sold_parent_usage_36mo: '', qty_used_in_mfg_36mo: '', qty_made_36mo: '',
});
export const filteredWoRequests = computed(() => {
    const q = woRequestSearch.value.trim().toLowerCase();
    if (!q) return woRequests.value;
    return woRequests.value.filter(r =>
        (r.part_number        || '').toLowerCase().includes(q) ||
        (r.description        || '').toLowerCase().includes(q) ||
        (r.sales_order_number || '').toLowerCase().includes(q) ||
        (r.submitted_by       || '').toLowerCase().includes(q)
    );
});

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

// woRequestSuggestedQty — how many to make: total demand minus est. stock, + 5%.
// Hidden when demand is zero or est. stock already covers demand.
export const woRequestSuggestedQty = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_used_12mo)           || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_period) || 0;
    const est    = woRequestEstQtyInStock.value;
    const total  = sold + parent;
    if (total === 0 || est === null) return null;
    const needed = total - est;
    if (needed <= 0) return null;
    return Math.ceil(needed * 1.05);
});

// woRequestStockWarning — true when qty made is ≥25% more than qty used in MFG,
// suggesting existing stock may cover this WO.
export const woRequestStockWarning = computed(() => {
    const form = woRequestDetailForm.value;
    const made = parseFloat(form.qty_made_past_12mo)  || 0;
    const used = parseFloat(form.qty_used_in_mfg)     || 0;
    const sold = parseFloat(form.qty_sold_used_12mo)  || 0;
    if (made === 0 || (used === 0 && sold === 0)) return false;
    return made >= (used + sold) * 1.25;
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

// woRequestSuggestedQty36mo — 3yr demand minus est. stock, + 5%.
export const woRequestSuggestedQty36mo = computed(() => {
    const form   = woRequestDetailForm.value;
    const sold   = parseFloat(form.qty_sold_36mo)               || 0;
    const parent = parseFloat(form.qty_sold_parent_usage_36mo)  || 0;
    const est    = woRequestEstQtyInStock36mo.value;
    const total  = sold + parent;
    if (total === 0 || est === null) return null;
    const needed = total - est;
    if (needed <= 0) return null;
    return Math.ceil(needed * 1.05);
});

// ── WO Forecasting ────────────────────────────────────────────
export const forecastingItems     = ref([]);
export const forecastingLoading   = ref(false);
export const forecastDeleteId     = ref(null); // ID pending hard-delete confirmation
export const forecastMoveBackId   = ref(null); // ID pending move-back-to-request confirmation
export const sendToForecastOpen   = ref(false);
export const sendToForecastTarget = ref(null);
export const sendToForecastForm   = ref({ forecast_date: '', forecast_reason: '' });
export const sendToForecastErrors = ref({ forecast_date: false, forecast_reason: false });

// ── Create WO ─────────────────────────────────────────────────
export const createWoItems       = ref([]);
export const createWoLoading     = ref(false);
export const createWoInlineState = ref({});
export const createWoTab         = ref('pending'); // 'pending' | 'created'
export const createdWoItems      = ref([]);

// createWoItemsGrouped — groups approved WO requests by traveller_id for display.
// Standalone items (no traveller) appear as single-item groups.
// Traveller groups share a header and are sorted so the parent (no parent_request_id) comes first.
export const createWoItemsGrouped = computed(() => {
    const groups = [];
    const byTraveller = {};
    for (const item of createWoItems.value) {
        if (!item.traveller_id) {
            groups.push({ travellerId: null, items: [item] });
        } else {
            if (!byTraveller[item.traveller_id]) {
                byTraveller[item.traveller_id] = { travellerId: item.traveller_id, items: [] };
                groups.push(byTraveller[item.traveller_id]);
            }
            byTraveller[item.traveller_id].items.push(item);
        }
    }
    // Sort each traveller group: parent (no parent_request_id) first
    for (const g of groups) {
        if (g.travellerId) g.items.sort((a, b) => (a.parent_request_id ? 1 : -1) - (b.parent_request_id ? 1 : -1));
    }
    return groups;
});

// createdWoItemsGrouped — same grouping logic as createWoItemsGrouped but for the Created tab.
export const createdWoItemsGrouped = computed(() => {
    const groups = [];
    const byTraveller = {};
    for (const item of createdWoItems.value) {
        if (!item.traveller_id) {
            groups.push({ travellerId: null, items: [item] });
        } else {
            if (!byTraveller[item.traveller_id]) {
                byTraveller[item.traveller_id] = { travellerId: item.traveller_id, items: [] };
                groups.push(byTraveller[item.traveller_id]);
            }
            byTraveller[item.traveller_id].items.push(item);
        }
    }
    for (const g of groups) {
        if (g.travellerId) g.items.sort((a, b) => (a.parent_request_id ? 1 : -1) - (b.parent_request_id ? 1 : -1));
    }
    return groups;
});

// ── Inventory ─────────────────────────────────────────────────
// inventoryMode drives which sub-view the shared #inventory view renders.
// 'parts' mode (old per-table chute/hitch/etc. lists) was removed; the
// remaining modes are PO Receive and the item_master Inventory Adjustment screen.
export const inventoryMode = ref('po_receive'); // 'po_receive' | 'adjust'

// ── Inventory Adjustment (item_master manual counts) ──────────
// Search a part #, view its current on-hand / last manual count, write a count.
export const inventoryAdjustSearch   = ref('');     // part # being looked up
export const inventoryAdjustLoading  = ref(false);  // true while fetching the item_master row
export const inventoryAdjustSearched = ref(false);  // true once a lookup has run (drives "not found" state)
export const inventoryAdjustResult   = ref(null);   // matched item_master row, or null
export const inventoryAdjustSaving   = ref(false);  // true while saving the manual count
export const inventoryAdjustForm     = ref({ qty: '', date: '' });
export const inventoryAdjustErrors   = ref({ qty: false });

// ── Completed Orders ──────────────────────────────────────────
export const completedOrders        = ref([]);
export const completedOrdersLoading = ref(false);

// ── Open Orders ───────────────────────────────────────────────
export const openOrders        = ref([]);
export const openOrdersLoading = ref(false);
export const openOrderColorPickerRow = ref(null);

export const openOrderAddModalOpen = ref(false);
export const openOrderAddMode      = ref('manual');
export const openOrderAddPasteText = ref('');
export const openOrderAddPasteRows = ref([]);
export const openOrderAddForm      = ref({
    part_number: '', to_ship: '', qty_pulled: '', description: '',
    store_bin: '', update_store_bin: '', customer: '', sales_order: '',
    date_entered: new Date().toISOString().split('T')[0], deadline: '', status: 'New/Picking',
    wo_va_notes: '', wo_po_number: '',
});
export const openOrderAddFormErrors = ref({});

export const openOrderEditingCell  = ref({ id: null, field: null });
export const openOrderEditingValue = ref('');
export const openOrderSelectedIds  = ref([]);
export const openOrderBulkStatus   = ref('');
export const openOrderDragOverSection = ref('');
export const openOrderDropZoneTarget  = ref('');
export const openOrderExpandedCols    = ref({});

export const openOrderWoPanel        = ref(null);
export const openOrderWoPanelOrders  = ref([]);
export const openOrderWoPanelLoading = ref(false);

export const openOrdersSort = ref({
    emergency: { field: 'sort_order', dir: 'asc' },
    freight:   { field: 'sort_order', dir: 'asc' },
    trac_vac:  { field: 'sort_order', dir: 'asc' },
    tru_cut:   { field: 'sort_order', dir: 'asc' },
});

function _openSectionSorted(type) {
    return computed(() => {
        const { field, dir } = openOrdersSort.value[type];
        const rows = openOrders.value.filter(o => o.order_type === type);
        return [...rows].sort((a, b) => {
            let av = a[field] ?? '';
            let bv = b[field] ?? '';
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    });
}
export const emergencyOrders = _openSectionSorted('emergency');
export const freightOrders   = _openSectionSorted('freight');
export const tracVacOrders   = _openSectionSorted('trac_vac');
export const truCutOrders    = _openSectionSorted('tru_cut');

export const openOrderSections = computed(() => [
    { type: 'emergency', label: 'EMERGENCY ORDERS', orders: emergencyOrders.value, hdr: 'bg-green-700'  },
    { type: 'freight',   label: 'FREIGHT ORDERS',   orders: freightOrders.value,   hdr: 'bg-amber-700'  },
    { type: 'trac_vac',  label: 'TRAC VAC ORDERS',  orders: tracVacOrders.value,   hdr: 'bg-slate-900'  },
    { type: 'tru_cut',   label: 'TRU CUT ORDERS',   orders: truCutOrders.value,    hdr: 'bg-red-700'    },
]);

// ── TEMPORARY: Subassy Setup (where-used explorer) ────────────
// Read-only BOM explorer state. Safe to delete this whole block when
// the temporary feature is removed.
export const subassySearch     = ref('');
export const subassyLoading    = ref(false);
export const subassyError      = ref('');
export const subassyRoot       = ref(null);   // { part, desc } of the searched part
export const subassyComponents = ref([]);     // [{ part, qty, desc }] immediate children (one level down)
export const subassyUsedOnRows = ref([]);     // flattened pre-order [{ child, part, qty, desc, depth, isUnit }] up to units
export const subassyTruncated  = ref(false);  // true when the used-on tree hit the node cap
export const subassyUnitExpanded = ref({});   // { [unitPart]: { loading, children:[{part,qty,desc}] } } — click-to-expand a unit's first-level BOM
// Popup: where a clicked component is used (walk-up in a modal)
export const subassyPopupOpen      = ref(false);
export const subassyPopupPart      = ref('');
export const subassyPopupLoading   = ref(false);
export const subassyPopupRows      = ref([]);
export const subassyPopupTruncated = ref(false);
