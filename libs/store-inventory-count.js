// ============================================================
// libs/store-inventory-count.js — Inventory Count sheet state
//
// Reactive state for the Inventory Count view (parts exported from
// a Production Planning run for a physical count) and its Adjust
// Inventory modal. ref/computed only — no fetches, no DB access.
// Re-exported by store.js.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── Count sheet ───────────────────────────────────────────────
export const invCountLines        = ref([]);     // inventory_count_lines rows
export const invCountLoading      = ref(false);
export const invCountRefs         = ref({});     // { NORM: item_master row } — descrip/bin/on-hand
export const invCountRefsLoading  = ref(false);
export const invCountShowAdjusted = ref(false);  // include already-adjusted rows
export const invCountFilter       = ref('');     // quick filter box
export const invCountSavingId     = ref(null);   // line id whose qty is being saved
export const invCountRemoveId     = ref(null);   // two-click remove confirm

// ── Adjust Inventory modal ────────────────────────────────────
export const invCountAdjustOpen    = ref(false);
export const invCountAdjustLine    = ref(null);  // the count line being adjusted
export const invCountAdjustItem    = ref(null);  // its item_master row (null = no row)
export const invCountAdjustLoading = ref(false);
export const invCountAdjustSaving  = ref(false);
export const invCountAdjustForm    = ref({ qty: '', date: '', counted_by: '' });
export const invCountAdjustErrors  = ref({ qty: false, counted_by: false });

// ── Computeds ─────────────────────────────────────────────────

// Rows in view: filtered by part / description / bin, then sorted by BIN so a
// counter walks the racks in order. Unbinned parts sink to the bottom.
// Adjusted rows sort after open ones — the work left to do stays on top.
export const filteredInvCountLines = computed(() => {
    const f = (invCountFilter.value || '').trim().toUpperCase();
    const rows = invCountLines.value.filter(l => {
        if (!f) return true;
        const ref = invCountRefs.value[l.part_number_normalized] || {};
        return (l.part_number_normalized || '').includes(f)
            || (ref.descrip || '').toUpperCase().includes(f)
            || (ref.bin || '').toUpperCase().includes(f);
    });
    return [...rows].sort((a, b) => {
        if (a.adjusted !== b.adjusted) return a.adjusted ? 1 : -1;
        const ba = (invCountRefs.value[a.part_number_normalized]?.bin || '').toUpperCase();
        const bb = (invCountRefs.value[b.part_number_normalized]?.bin || '').toUpperCase();
        if (ba !== bb) return (ba ? ba : '￿').localeCompare(bb ? bb : '￿');
        return (a.part_number_normalized || '').localeCompare(b.part_number_normalized || '');
    });
});

// Sheet progress chips: still to count, counted but not adjusted, adjusted.
export const invCountOpenCount = computed(() =>
    invCountLines.value.filter(l => !l.adjusted && l.qty_counted == null).length);
export const invCountCountedCount = computed(() =>
    invCountLines.value.filter(l => !l.adjusted && l.qty_counted != null).length);
export const invCountAdjustedCount = computed(() =>
    invCountLines.value.filter(l => l.adjusted).length);
