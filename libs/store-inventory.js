// ============================================================
// libs/store-inventory.js — CS, WO files, WO requests, inventory,
//                           open orders reactive state
//
// Re-exported by store.js. No imports from store.js.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { openOrderMatchesFilter, compareSalesOrder } from './utils.js';
import { OPEN_ORDER_STATUS_NEW, OPEN_ORDER_STATUS_LABEL_PRINTED, OPEN_ORDER_OLD_CUTOFF_SO } from './config.js';

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
    qty_on_order: '', qty_in_stock: '',
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

// woRequestSubpartStack — drill-in stack for inspecting a subpart as if it were the
// requested part. Each entry is a snapshot of the parent detail context (see
// inspectSubpart in wo-request-detail.js). Empty = viewing the top-level request.
export const woRequestSubpartStack = ref([]);
// woRequestMarkAllSubparts — checkbox in the subpart inspector. When ticked, clicking
// Done copies the inspected subpart's fields into every other subpart (blank fields only).
export const woRequestMarkAllSubparts = ref(false);
// isSubpartInspect — true while the detail modal is showing a drilled-in subpart.
export const isSubpartInspect = computed(() => woRequestSubpartStack.value.length > 0);
// woRequestSubpartParentLabel — parent part # of the subpart currently being inspected.
export const woRequestSubpartParentLabel = computed(() => {
    const s = woRequestSubpartStack.value;
    return s.length ? (s[s.length - 1].subpartPart || '') : '';
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

// woRequestCalcChain — replacement-chain info ({ chain, links }) for the open WO
// request's part, from part_changes. null when the part has no replacement history.
// Set by openWoRequestDetail; drives the "includes history from…" breadcrumb.
export const woRequestCalcChain = ref(null);

// woRequestChainParts — predecessor part numbers whose history is combined into
// the data-panel sums (chain minus the part itself). Empty array = no breadcrumb.
export const woRequestChainParts = computed(() =>
    (woRequestCalcChain.value?.chain || []).slice(1)
);

// Carry-forward notes (part_notes) for the open WO request's part. Each is
// { text, date } or null — set by loadWoRequestCarriedNotes when the detail
// modal opens. Shown as a dated caption and pre-filled into the matching note
// field only when that field is currently empty (never clobbers a typed note).
export const woRequestCarriedStatusNote     = ref(null);
export const woRequestCarriedProductionNote = ref(null);

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

// woRequestYearlyAvg36mo — Since-Jan-2023 totals divided by 3 (≈ per-year average).
// Returns { sold, parent, mfg, made }; each value is null when the source is blank.
export const woRequestYearlyAvg36mo = computed(() => {
    const f = woRequestDetailForm.value;
    const avg = (v) => {
        const n = parseFloat(v);
        return isNaN(n) ? null : Math.round(n / 3);
    };
    return {
        sold:   avg(f.qty_sold_36mo),
        parent: avg(f.qty_sold_parent_usage_36mo),
        mfg:    avg(f.qty_used_in_mfg_36mo),
        made:   avg(f.qty_made_36mo),
    };
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
export const openOrdersFilter  = ref('');   // search box across all sections
export const shippingTab       = ref('orders');  // 'orders' | 'boxed' — shipping board sub-tab
export const openOrderColorPickerRow = ref(null);
export const openOrderWoMenuRow      = ref(null);   // WO/PO # cell action menu (Edit / Go to WO)

export const openOrderAddModalOpen = ref(false);
export const openOrderAddMode      = ref('manual');
export const openOrderAddPasteText = ref('');
export const openOrderAddPasteRows = ref([]);
// How the last paste's columns were read, for the preview banner. Shape:
//   { mode: 'header'|'positional', recognized: string[], unrecognized: string[],
//     shipNonNumeric: number }  (null before any paste is parsed).
export const openOrderPasteColumnInfo = ref(null);
export const openOrderAddForm      = ref({
    part_number: '', to_ship: '', qty_pulled: '', description: '',
    store_bin: '', update_store_bin: '', customer: '', sales_order: '',
    date_entered: new Date().toISOString().split('T')[0], deadline: '', status: OPEN_ORDER_STATUS_NEW,
    wo_va_notes: '', wo_po_number: '',
});
export const openOrderAddFormErrors = ref({});

// Paste-preview counts: rows that will actually insert, flagged duplicates,
// and rows whose date/status was adjusted during parsing.
export const openOrderPasteAddCount = computed(() =>
    openOrderAddPasteRows.value.filter(r => !r._dupe || r._add_anyway).length);
export const openOrderPasteDupCount = computed(() =>
    openOrderAddPasteRows.value.filter(r => r._dupe).length);
export const openOrderPasteWarnCount = computed(() =>
    openOrderAddPasteRows.value.filter(r => r._date_warn || r._status_warn).length);

export const openOrderEditingCell  = ref({ id: null, field: null });
export const openOrderEditingValue = ref('');
// Confirm gate before editing To Ship / order qty. { id, value } while open, id=null when closed.
export const openOrderQtyConfirm   = ref({ id: null, value: null });
export const openOrderSelectedIds  = ref([]);
// The single selected row (null unless exactly one is selected) — drives the
// per-row Backorder / Un-backorder control in the floating selection action bar.
export const openOrderSingleSelectedRow = computed(() => {
    const ids = openOrderSelectedIds.value;
    if (ids.length !== 1) return null;
    return openOrders.value.find(o => o.id === ids[0]) || null;
});
export const openOrderBulkStatus   = ref('');
export const openOrderDragOverSection = ref('');
export const openOrderDropZoneTarget  = ref('');
export const openOrderExpandedCols    = ref({});

export const openOrderWoPanel        = ref(null);
export const openOrderWoPanelOrders  = ref([]);
export const openOrderWoPanelLoading = ref(false);

export const openOrdersSort = ref({
    new:       { field: 'sales_order', dir: 'asc' },
    emergency: { field: 'sales_order', dir: 'asc' },
    freight:   { field: 'sales_order', dir: 'asc' },
    trac_vac:  { field: 'sales_order', dir: 'asc' },
    tru_cut:   { field: 'sales_order', dir: 'asc' },
    boxed:     { field: 'sales_order', dir: 'asc' },
});

// _sortSectionRows — sort one section's rows by its openOrdersSort entry.
// Sales-order sort is numeric-aware; other fields fall back to case-insensitive
// string compare. Shared by every section so all sort uniformly.
function _sortSectionRows(rows, sortKey) {
    const { field, dir } = openOrdersSort.value[sortKey];
    return [...rows].sort((a, b) => {
        let p;
        if (field === 'sales_order') {
            p = dir === 'asc' ? compareSalesOrder(a.sales_order, b.sales_order)
                              : compareSalesOrder(b.sales_order, a.sales_order);
        } else {
            let av = a[field] ?? '', bv = b[field] ?? '';
            if (typeof av === 'string') av = av.toLowerCase();
            if (typeof bv === 'string') bv = bv.toLowerCase();
            p = av < bv ? (dir === 'asc' ? -1 : 1) : av > bv ? (dir === 'asc' ? 1 : -1) : 0;
        }
        // Direction-independent tiebreak: a backordered line sinks to the bottom
        // of its SO run (same primary key) so it reads as separated from siblings.
        return p !== 0 ? p : (a.backordered ? 1 : 0) - (b.backordered ? 1 : 0);
    });
}

// soWithNewSibling — Set of non-blank sales_orders that still have a 'New'-inbox
// line. Enforces "no SO splitting": a sales order stays parked in New Orders until
// ALL its lines are triaged. A backordered line is exempt — deliberately separated,
// it never holds its siblings in New.
export const soWithNewSibling = computed(() => {
    const s = new Set();
    for (const o of openOrders.value) {
        if (o.backordered || (o.status || '') !== OPEN_ORDER_STATUS_NEW) continue;
        const so = (o.sales_order || '').trim();
        if (so) s.add(so);
    }
    return s;
});

// Brand sections: rows for one order_type. Excludes 'New'/SO-held (New Orders) and
// Boxed/Label-Printed (Boxed tab). Backordered lines show here (flagged) even if 'New'.
function _openSectionSorted(type) {
    return computed(() => {
        const q = openOrdersFilter.value.trim().toLowerCase();
        const rows = openOrders.value.filter(o => {
            if (o.order_type !== type) return false;
            const status = o.status || '';
            if (status === 'Boxed' || status === OPEN_ORDER_STATUS_LABEL_PRINTED) return false;
            if (!openOrderMatchesFilter(o, q)) return false;
            if (o.backordered) return true;
            if (status === OPEN_ORDER_STATUS_NEW) return false;
            const so = (o.sales_order || '').trim();
            if (so && soWithNewSibling.value.has(so)) return false;
            return true;
        });
        return _sortSectionRows(rows, type);
    });
}
export const emergencyOrders = _openSectionSorted('emergency');
export const freightOrders   = _openSectionSorted('freight');
export const tracVacOrders   = _openSectionSorted('trac_vac');
export const truCutOrders    = _openSectionSorted('tru_cut');

// New Orders: 'New' rows + triaged rows whose SO still has a New sibling (whole SO
// rides together until fully triaged). Backordered lines live on the brand board,
// not the inbox. Boxed/Label-Printed stay in the Boxed tab.
// Split by SO#: rows sorting before OPEN_ORDER_OLD_CUTOFF_SO sink to a separate
// "OLD, NEW ORDERS" section; blank SO# stays on top so it gets noticed
// (compareSalesOrder sorts blanks last, so they never read as old).
function _isOldInboxRow(o) {
    return compareSalesOrder(o.sales_order, OPEN_ORDER_OLD_CUTOFF_SO) < 0;
}
function _isNewInboxRow(o, q) {
    if (!openOrderMatchesFilter(o, q)) return false;
    if (o.backordered) return false;
    const status = o.status || '';
    if (status === OPEN_ORDER_STATUS_NEW) return true;
    if (status === 'Boxed' || status === OPEN_ORDER_STATUS_LABEL_PRINTED) return false;
    const so = (o.sales_order || '').trim();
    return !!so && soWithNewSibling.value.has(so);
}
export const newOrders = computed(() => {
    const q = openOrdersFilter.value.trim().toLowerCase();
    const rows = openOrders.value.filter(o =>
        _isNewInboxRow(o, q) && !_isOldInboxRow(o));
    return _sortSectionRows(rows, 'new');
});
export const oldNewOrders = computed(() => {
    const q = openOrdersFilter.value.trim().toLowerCase();
    const rows = openOrders.value.filter(o =>
        _isNewInboxRow(o, q) && _isOldInboxRow(o));
    return _sortSectionRows(rows, 'new');
});

// Boxed, Ready to Ship: rows waiting on a physical label + ship. Includes
// 'Label Printed' (label printed, awaiting the final 'Labelled' → ship step).
export const boxedOrders = computed(() => {
    const q = openOrdersFilter.value.trim().toLowerCase();
    const rows = openOrders.value.filter(o =>
        ((o.status || '') === 'Boxed' || (o.status || '') === OPEN_ORDER_STATUS_LABEL_PRINTED)
        && openOrderMatchesFilter(o, q));
    return _sortSectionRows(rows, 'boxed');
});

// The Boxed tab splits into two stacked categories (same pattern as the brand
// boards): Freight = rows that rode in as order_type='freight' (boxing only
// changes status, so order_type is preserved); UPS = everything else. Both
// derive from the already-sorted boxedOrders, so sort/filter carry over.
export const boxedFreightOrders = computed(() =>
    boxedOrders.value.filter(o => o.order_type === 'freight'));
export const boxedUpsOrders = computed(() =>
    boxedOrders.value.filter(o => o.order_type !== 'freight'));

// Board sections for the current shipping tab. 'boxed' tab shows the Boxed
// staging area split into UPS + Freight; 'orders' tab shows New Orders atop the
// 4 brand boards. All
// render through the one grid (view-open-orders.html) — so New/Boxed inherit
// SO# grouping and the full row layout for free.
export const openOrderSections = computed(() => {
    if (shippingTab.value === 'boxed') {
        // Both keep type 'boxed' so grid layout, sort, and drag rules are shared.
        return [
            { type: 'boxed', label: 'UPS, READY TO SHIP',     orders: boxedUpsOrders.value,     hdr: 'bg-emerald-700' },
            { type: 'boxed', label: 'FREIGHT, READY TO SHIP', orders: boxedFreightOrders.value, hdr: 'bg-amber-700'   },
        ];
    }
    return [
        { type: 'new',       label: 'NEW ORDERS',       orders: newOrders.value,       hdr: 'bg-sky-700'    },
        // Same type ('new') so the inbox layout/sort/drag rules apply unchanged;
        // section only appears while old-dated inbox rows remain.
        ...(oldNewOrders.value.length
            ? [{ type: 'new', label: 'OLD, NEW ORDERS', orders: oldNewOrders.value, hdr: 'bg-sky-900' }]
            : []),
        { type: 'emergency', label: 'EMERGENCY ORDERS', orders: emergencyOrders.value, hdr: 'bg-green-700'  },
        { type: 'freight',   label: 'FREIGHT ORDERS',   orders: freightOrders.value,   hdr: 'bg-amber-700'  },
        { type: 'trac_vac',  label: 'TRAC VAC ORDERS',  orders: tracVacOrders.value,   hdr: 'bg-slate-900'  },
        { type: 'tru_cut',   label: 'TRU CUT ORDERS',   orders: truCutOrders.value,    hdr: 'bg-red-700'    },
    ];
});


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
