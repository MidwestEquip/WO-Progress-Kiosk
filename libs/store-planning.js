// ============================================================
// libs/store-planning.js — Production Planning reactive state
//
// Base Units tab: saved-unit list + kit wizard state.
// ref() and computed() only — no fetch, no DB. Re-exported by store.js.
// ============================================================

import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.esm-browser.prod.js';

// ── View / tabs ───────────────────────────────────────────────
export const planningTab = ref('base_units');

// ── Saved base units list ─────────────────────────────────────
export const baseUnits         = ref([]);
export const baseUnitsLoading  = ref(false);
export const baseUnitDetail    = ref(null);   // { unit, options:[{...option, parts:[]}] } or null
export const baseUnitDeleteId  = ref(null);   // two-click delete confirm

// ── Kit wizard ────────────────────────────────────────────────
export const buWizardOpen    = ref(false);
export const buWizardStep    = ref('pick');   // 'pick' | 'review'
export const buFamilySearch  = ref('');
export const buSearchLoading = ref(false);
export const buConfigResults = ref([]);       // [{ config, lineCount, included }]
export const buDeriving      = ref(false);

// Editable kit model built by runBuDerivation():
// { base:[{part_number,qty,flag,descrip}], qtyVaries:[...], configs:[...],
//   singleConfig, steps:[{ name, required, choices:[{ label, configs,
//   parts:[{part_number,qty,flag,descrip}], source }] }] }
export const buKit             = ref(null);
export const buModularChildren = ref([]);     // [{ part_number, inConfigs }]
export const buSaveForm        = ref({ family_name: '', base_part_number: '', notes: '' });
export const buSaveErrors      = ref({});
export const buSaving          = ref(false);

// Manual-option inline form (adds a choice to a step, or a new step)
export const buManualForm = ref({ stepIndex: '', group: '', label: '', part_number: '', qty: 1 });

// Review-step editing: two-click step delete, and the "si|ci" key of the
// choice whose add-part lookup is in flight. Per-choice add-part inputs live
// on the choice object itself (c.newPart) alongside c.label — see buKit.
export const buStepDeleteIndex = ref(null);
export const buPartAdding      = ref('');

// ── Saved base unit editor ────────────────────────────────────
// Steps are rebuilt from base_unit_options rows on every load; each step keeps
// its ORIGINAL (sort_order, group) so a rename can still find its rows.
// [{ sort_order, origGroup, group, required, newChoice,
//    choices: [{ id, choice_label, is_default, source, parts:[], newPart }] }]
export const baseUnitEditOpen      = ref(false);
export const baseUnitEditUnit      = ref(null);   // base_units row
export const baseUnitEditSteps     = ref([]);
export const baseUnitEditLoading   = ref(false);
export const baseUnitEditSaving    = ref('');     // key of the write in flight
export const baseUnitEditDeleteKey = ref(null);   // two-click delete arm
export const baseUnitEditStepForm  = ref({ group: '', required: false, label: '' });
// Bumped when the editor closes; a main.js watch reloads the saved-unit list
// (pages never import pages — same pattern as the planningTab tab loaders).
export const loadBaseUnitsRequested = ref(0);

// ── Plan tab ──────────────────────────────────────────────────
export const planBaseUnit     = ref(null);    // fetchBaseUnitDetail result
export const planQty          = ref(null);
export const planMode         = ref('full_kit');  // 'full_kit' | 'base_only'
export const planRequiredDate = ref('');
export const planNotes        = ref('');
export const planSplits       = ref([]);      // [{ group, required, choices:[{ label, parts, qty, partLess }] }]
export const planRunning      = ref(false);

// ── Review tab ────────────────────────────────────────────────
export const planningRuns       = ref([]);
export const planningRunsLoading = ref(false);
export const selectedRun        = ref(null);
export const runLines           = ref([]);
export const runLinesLoading    = ref(false);
export const runLineFilter      = ref('');
// Derived on run open, not stored on the line: descriptions come from
// item_master, and where-used is inverted from the live BOM.
export const runLineDescrips    = ref({});    // { NORM: descrip }
export const runWhereUsed       = ref({});    // { NORM: [parent part #] }
export const runChildIndex      = ref({});    // { NORM: [{ child, qpa }] }
export const runRefsLoading     = ref(false);

// Qty cascade confirm: preview of a parent qty change flowing to its subparts
export const qtyCascadeOpen    = ref(false);
export const qtyCascadeSaving  = ref(false);
export const qtyCascadePreview = ref(null);   // { part, from, to, delta, changes, skipped }
export const releaseDueLines    = ref([]);
export const releasingLineId    = ref(null);
export const runApproving       = ref(false);

// ── Part Data modal (read-only, opened from the Review grid) ──
export const partDataOpen    = ref(false);
export const partDataPart    = ref('');
export const partDataLoading = ref(false);
export const partData        = ref(null);   // fetchPartDataBundle result
export const partDataWip     = ref(null);   // bucketPartWip(partData.wipRaw)

// ── Queues / Alerts tab ───────────────────────────────────────
export const queueRows        = ref([]);      // banded parts + coverage, ranked
export const queueLoading     = ref(false);
export const queueLoadedAt    = ref(null);    // staleness banner
export const queueDeptFilter  = ref('all');   // 'all'|'Assy'|'Fab'|'Weld'|'Unrouted'
export const lowStockAlerts   = ref([]);
export const bandEditorOpen   = ref(false);
export const bandForm         = ref({});      // upsertPartPlanning fields
export const bandSaving       = ref(false);
export const queueProposingId = ref(null);

// ── Workload tab ──────────────────────────────────────────────
export const workCenters        = ref([]);
export const workloadLines      = ref([]);    // approved/released lines w/ dates
export const workloadRoutings   = ref({});    // { NORM: [routing rows] }
export const workloadLoading    = ref(false);
export const workloadLoadedAt   = ref(null);
export const wcForm             = ref({ name: '', dept: '', available_hours_week: 40 });
export const routingForm        = ref({ part_number: '', work_center_id: '', seq: 1, setup_hours: 0, run_hours_per_part: 0 });
export const routingSuggestion  = ref(null);  // fetchTimeStatsForPart result

// ── Computeds ─────────────────────────────────────────────────

// Per-step split totals + validation (required steps must total planQty exactly)
export const planSplitStatus = computed(() => {
    const qty = Number(planQty.value) || 0;
    return planSplits.value.map(s => {
        const total = s.choices.reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
        return {
            group: s.group, required: s.required, total,
            ok: s.required ? total === qty : total <= qty,
        };
    });
});
export const planSplitsValid = computed(() =>
    planMode.value === 'base_only' || planSplitStatus.value.every(s => s.ok));

// Review grid rows filtered by the quick filter box
export const filteredRunLines = computed(() => {
    const f = (runLineFilter.value || '').trim().toUpperCase();
    if (!f) return runLines.value;
    return runLines.value.filter(l =>
        l.part_number_normalized.includes(f)
        || (l.action || '').toUpperCase().includes(f)
        || (runLineDescrips.value[l.part_number_normalized] || '').toUpperCase().includes(f));
});

// Queue rows for the active dept chip, ranked worst-coverage first
export const filteredQueueRows = computed(() => {
    const d = queueDeptFilter.value;
    const rows = d === 'all' ? queueRows.value : queueRows.value.filter(r => r.dept === d);
    return [...rows].sort((a, b) => {
        const av = a.days_of_supply === null ? Infinity : a.days_of_supply;
        const bv = b.days_of_supply === null ? Infinity : b.days_of_supply;
        return av - bv;
    });
});

// Workload heatmap: rows = work centers, cols = next 8 Mondays,
// cell hours = Σ over lines released that week of (setup + run×qty) per routing.
export const workloadWeeks = computed(() => {
    const weeks = [];
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // this week's Monday
    for (let i = 0; i < 8; i++) {
        const w = new Date(d.getTime()); w.setDate(w.getDate() + i * 7);
        weeks.push(w.toISOString().slice(0, 10));
    }
    return weeks;
});
export const workloadGrid = computed(() => {
    const weeks = workloadWeeks.value;
    const grid = {};   // wcId -> { weekStart: hours }
    workloadLines.value.forEach(l => {
        const qty = Number(l.override_qty ?? l.recommended) || 0;
        if (!(qty > 0) || !l.planned_release_date) return;
        const rel = l.planned_release_date;
        let wk = weeks[0];
        for (const w of weeks) { if (rel >= w) wk = w; }
        if (rel < weeks[0]) wk = weeks[0];               // overdue lands this week
        (workloadRoutings.value[l.part_number_normalized] || []).forEach(r => {
            const hrs = (Number(r.setup_hours) || 0) + (Number(r.run_hours_per_part) || 0) * qty;
            if (!grid[r.work_center_id]) grid[r.work_center_id] = {};
            grid[r.work_center_id][wk] = (grid[r.work_center_id][wk] || 0) + hrs;
        });
    });
    return grid;
});

export const buIncludedConfigs = computed(() =>
    buConfigResults.value.filter(c => c.included).map(c => c.config));

export const buExcludedConfigs = computed(() =>
    buConfigResults.value.filter(c => !c.included).map(c => c.config));

export const buModularLabel = computed(() =>
    buModularChildren.value.map(m => m.part_number).join(', '));

// Part Data modal figures. Same formulas as the WO Request panel
// (store-stock.js woRequestEstQtyInStock / woRequestSuggestedQty) — kept as
// separate computeds because they read the bundle, not the request form.
export const partDataPipelineQty = computed(() => partDataWip.value?.total || 0);

export const partDataEstInStock = computed(() => {
    const d = partData.value;
    if (!d) return null;
    const sold   = Number(d.usage12.qty_sold_used_12mo) || 0;
    const parent = Number(d.parentDemand12)             || 0;
    const mfg    = Number(d.usage12.qty_used_in_mfg)    || 0;
    const made   = Number(d.usage12.qty_made_past_12mo) || 0;
    if (sold === 0 && parent === 0 && mfg === 0 && made === 0) return null;
    return mfg - (sold + parent) + (made - mfg);
});

export const partDataSuggestedQty = computed(() => {
    const d = partData.value;
    if (!d) return null;
    const total = (Number(d.usage12.qty_sold_used_12mo) || 0) + (Number(d.parentDemand12) || 0);
    const est   = partDataEstInStock.value;
    if (total === 0 || est === null) return null;
    const needed = total - Math.max(est, 0) - partDataPipelineQty.value;
    return needed <= 0 ? null : Math.ceil(needed * 1.05);
});

export const buFlagCount = computed(() => {
    const kit = buKit.value;
    if (!kit) return 0;
    let n = kit.base.filter(p => p.flag).length + kit.qtyVaries.length;
    kit.steps.forEach(s => s.choices.forEach(c => { n += c.parts.filter(p => p.flag).length; }));
    return n;
});
