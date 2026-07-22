// ============================================================
// libs/store-open-orders.js — Open Orders "Waiting On" reactive state
//
// Split from store-inventory.js (500-line cap). Re-exported by store.js.
// Holds only the Waiting On modal + the derived live WO-status map. No imports
// from store.js. ref/computed only — no fetch calls, no DB access.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';
import { openOrderMatchesFilter } from './utils.js';
import { completedOrders } from './store-inventory.js';

// ── Completed (Shipped) Orders search ─────────────────────────
// Live filter box for the Completed Orders view. Reuses the pure
// openOrderMatchesFilter (completed rows share the open-order shape, incl.
// wo_va_notes). completedOrders itself lives in store-inventory.js; imported
// here (one-way) so the filtered computed can co-locate with the filter ref.
export const completedOrdersFilter = ref('');
export const filteredCompletedOrders = computed(() => {
    const q = completedOrdersFilter.value.trim().toLowerCase();
    if (!q) return completedOrders.value;
    return completedOrders.value.filter(o => openOrderMatchesFilter(o, q));
});

// Inline cell editing for the Completed Orders table (notes, tracking #).
// Dedicated refs, isolated from the open-order board edit state (which carries
// ship side-effects). { id, field } identifies the active cell; value is the draft.
export const completedEditingCell  = ref({ id: null, field: null });
export const completedEditingValue = ref('');

// ── Waiting On modal ──────────────────────────────────────────
// A row can be blocked on several missing subparts. Each entry is
// { _k, part_number, wo_number }; _k is a stable client key for v-for (never
// persisted). Only { part_number, wo_number } are written to open_orders.waiting_on.
export const waitingOnModalOpen = ref(false);
export const waitingOnRow       = ref(null);   // the open_orders row being edited
export const waitingOnForm      = ref({ entries: [] });
export const waitingOnErrors    = ref({});
export const waitingOnSaving    = ref(false);

// ── Backorder modal ───────────────────────────────────────────
// Splits one line off its sales order: ship the rest now, hold the backordered
// part. backorderForm.qty is how many to backorder (defaults to the full line);
// a partial qty splits the row (ship-now stays, a new flagged remainder row is
// created). backordered itself is stored on open_orders (a boolean); the qty is
// not stored — it is the backordered row's own to_ship.
export const backorderModalOpen = ref(false);
export const backorderRow       = ref(null);   // the open_orders row being backordered
export const backorderForm      = ref({ qty: '' });
export const backorderErrors    = ref({});
export const backorderSaving    = ref(false);

// ── Receiving modal: sales orders using this part ─────────────
// Populated when the office opens the WO Receiving modal — open_orders rows the
// received part feeds (direct part match or a waiting_on subpart match). receiveSoAck
// is the soft-gate checkbox: when matches exist, the receiver ticks it to confirm
// they've handled those sales orders before marking the WO received (never blocks
// hard). All three reset each time the modal opens.
export const receiveMatchedSos     = ref([]);
export const receiveMatchedLoading = ref(false);
export const receiveSoAck          = ref(false);

// ── Derived live WO status for waiting-on subparts ────────────
// waitingOnWoRows holds the raw work_orders rows (one per dept per WO) fetched
// on Open Orders view enter. woStatusByNumber collapses them to ONE
// representative status per wo_number (keyed trim+UPPER to match how work_orders
// stores wo_number). Precedence: all-completed → completed; else any started →
// started; else paused; else on_hold; else not_started. A wo_number absent from
// the map (typo / cleared / not yet loaded) reads undefined — the column renders
// a '—' fallback.
export const waitingOnWoRows = ref([]);

// _collapseStatuses — reduce a set of per-dept work_orders statuses for one WO to
// a single representative value. Precedence: all-completed → completed; else any
// started → started; else paused; else on_hold; else not_started.
function _collapseStatuses(set) {
    return set.every(s => s === 'completed') ? 'completed'
        : set.includes('started')  ? 'started'
        : set.includes('paused')   ? 'paused'
        : set.includes('on_hold')  ? 'on_hold'
        : 'not_started';
}

export const woStatusByNumber = computed(() => {
    const byWo = {};
    for (const r of waitingOnWoRows.value) {
        const wo = (r.wo_number || '').trim().toUpperCase();
        if (!wo) continue;
        (byWo[wo] = byWo[wo] || []).push(r.status || '');
    }
    const map = {};
    for (const wo in byWo) map[wo] = _collapseStatuses(byWo[wo]);
    return map;
});

// waitingOnWoByPartRows — raw active (non-completed, WO#-assigned) work_orders
// rows for every waiting-on subpart's PART number, fetched on view enter. This is
// how a subpart's WO auto-links: once the requested WO is created and has an
// official WO#, it shows up here keyed by part.
export const waitingOnWoByPartRows = ref([]);

// woInfoByPart — part # → { wo_number, status } for the auto-linked subpart WO.
// One part can have several active WOs; we pick a non-completed one (collapsing
// its dept rows). Lets a waiting-on entry with no manually-typed WO# still show
// the created WO's number + live status.
export const woInfoByPart = computed(() => {
    const byPart = {};
    const pendingByKey = {};   // part → { [id]: true if id is a job_number (pending) }
    for (const r of waitingOnWoByPartRows.value) {
        const part   = (r.part_number || '').trim().toUpperCase();
        const realWo = (r.wo_number || '').trim().toUpperCase();
        // Prefer the official WO#; fall back to the internal job_number for a WO that
        // has been created but is still awaiting its official Alere WO# (wo_number null).
        const wo = realWo || (r.job_number != null ? String(r.job_number).trim().toUpperCase() : '');
        if (!part || !wo) continue;
        byPart[part] = byPart[part] || {};
        (byPart[part][wo] = byPart[part][wo] || []).push(r.status || '');
        (pendingByKey[part] = pendingByKey[part] || {})[wo] = !realWo;
    }
    const map = {};
    for (const part in byPart) {
        let chosenWo = null, chosenStatus = null;
        for (const wo in byPart[part]) {
            const collapsed = _collapseStatuses(byPart[part][wo]);
            // prefer a not-yet-completed WO; otherwise take whatever we have
            if (!chosenWo || (chosenStatus === 'completed' && collapsed !== 'completed')) {
                chosenWo = wo; chosenStatus = collapsed;
            }
        }
        // pending = the chosen id is a job_number (WO created, official WO# not yet entered).
        if (chosenWo) map[part] = { wo_number: chosenWo, status: chosenStatus, pending: !!pendingByKey[part][chosenWo] };
    }
    return map;
});
