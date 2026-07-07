// ============================================================
// pages/wo-request-detail.js — WO Request detail modal logic
//
// Handles: opening/populating the detail modal (routing, usage
//          data, BOM subparts), part-print files, and modal close.
// Split from wo-request-view.js (500-line cap). Imports from
// store + db + utils only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';
import { PURCHASING_3YR_START } from '../libs/config.js';

// _detailGen — monotonic open-generation counter. openWoRequestDetail captures it; every
// fire-and-forget load checks it before writing, so a newer open (or a subpart drill-in/
// restore) cancels stale writes that would otherwise clobber the part now on screen.
let _detailGen = 0;

// boolToYesNo — maps a boolean DB value to 'yes'/'no'/'' for dropdown binding.
function boolToYesNo(val) {
    if (val === true)  return 'yes';
    if (val === false) return 'no';
    return '';
}

const SUBPART_FORM_BLANK = () => ({ expanded: false, defaultsLoaded: false, qty_to_make: '', fab: '', fab_print: '', weld: '', weld_print: '', assy_wo: '', color: '', bent_rolled_part: '', date_to_start: '', estimated_lead_time: '', set_up_time: '' });

// openSubpartWoForm — toggle the inline (compact) WO form for a subpart row; auto-fills
// defaults on first open. The fuller, data-rich alternative is inspectSubpart (full-screen).
// Both edit the same woRequestSubpartForms[key] entry, so either path can be used per row.
export async function openSubpartWoForm(sub) {
    const n = sub.item_child_normalized;
    const forms = store.woRequestSubpartForms.value;
    if (!forms[n]) forms[n] = SUBPART_FORM_BLANK();
    forms[n].expanded = !forms[n].expanded;
    store.woRequestSubpartForms.value = { ...forms };
    if (forms[n].expanded && !forms[n].defaultsLoaded) {
        forms[n].defaultsLoaded = true;
        const { data: d } = await db.fetchPartApprovalDefault(sub.item_child);
        if (d) {
            const F = ['fab','fab_print','weld','weld_print','assy_wo','color','bent_rolled_part'];
            F.forEach(f => { if (!forms[n][f] && d[f]) forms[n][f] = d[f]; });
            store.woRequestSubpartForms.value = { ...forms };
        }
    }
}

// calcSubpartStats — batch-fetch made/sold/parent demand for all BOM children concurrently.
async function calcSubpartStats(subparts) {
    const norms = subparts.map(s => s.item_child_normalized);
    const [[{ data: madeMap }, { data: sales }], demands] = await Promise.all([
        Promise.all([db.fetchPartsMadeAllTime(norms), db.fetchQtySoldFromSalesAnalysis(norms)]),
        Promise.all(norms.map(n => db.calculateRecursiveParentUsageDemand(n).then(r => r.data?.totalDemand || 0))),
    ]);
    const stats = {};
    subparts.forEach((s, i) => {
        const n = s.item_child_normalized;
        stats[n] = { made: (madeMap || {})[n] || 0, sold: +(sales || {})[n] || 0, parent: demands[i] };
    });
    return stats;
}

// openWoRequestDetail — select a request and populate the manager detail form.
// Boolean DB fields (fab, weld, bent_rolled_part) are mapped to 'yes'/'no' strings
// to support <select> binding. fab_print/weld_print store 'yes'/'no' as text.
// Also loads any existing part prints into woFiles so they show in the modal.
// After populating from the request, fetches part_approval_defaults and fills
// only blank routing fields — never overwrites values already on the request.
export async function openWoRequestDetail(req) {
    const gen = ++_detailGen;             // this open's generation; stale loads bail on mismatch
    store.selectedWoRequest.value        = req;
    store.woRequestDefaultsApplied.value = false;
    const today = new Date().toISOString().slice(0, 10);
    store.woRequestDetailForm.value = {
        sales_order_number:            req.sales_order_number            ?? '',
        alere_qty:                     req.alere_qty                     ?? '',
        qty_sold_used_12mo:            req.qty_sold_used_12mo            ?? '',
        qty_sold_parent_usage_period:  req.qty_sold_parent_usage_period  ?? '',
        qty_used_in_mfg:               req.qty_used_in_mfg               ?? '',
        qty_made_past_12mo:            req.qty_made_past_12mo            ?? '',
        where_used:                    req.where_used                    || '',
        qty_to_make:         req.qty_to_make         ?? '',
        fab:                 req.fab       || '',   // TEXT 'yes'/'no' after migration
        fab_print:           req.fab_print === 'yes' ? 'yes' : req.fab_print === 'no' ? 'no' : '',
        weld:                req.weld      || '',   // TEXT area name after migration
        weld_print:          req.weld_print === 'yes' ? 'yes' : req.weld_print === 'no' ? 'no' : '',
        assy_wo:             req.assy_wo             || '',
        color:               req.color               || '',
        bent_rolled_part:    boolToYesNo(req.bent_rolled_part),
        set_up_time:         req.set_up_time         ?? '',
        alere_bin:           req.alere_bin           || '',
        estimated_lead_time: req.estimated_lead_time ?? '',
        sent_to_production:  req.sent_to_production  ?? false,
        date_to_start:       req.date_to_start       || today,   // default to today; manager can change
        production_notes:    req.production_notes    || '',
        staging_area:        req.staging_area        || '',
        status_notes:        req.status_notes        || '',
        on_hold:             req.on_hold             || false
    };

    // Assembly WO template — when flagged on the New Request form, force the
    // assemble-only routing. This OVERRIDES part defaults / any prior values for
    // these fields (the part-defaults fill below is skipped for assembly requests).
    if (req.is_assembly) {
        Object.assign(store.woRequestDetailForm.value, {
            fab: 'no', fab_print: 'no', weld: 'Assemble', weld_print: 'no',
            staging_area: 'W5 Staging', assy_wo: '', color: '',
            bent_rolled_part: 'no', set_up_time: 0,
        });
    }
    loadWoFilesForRequest(req.part_number);

    // Live active-WO warning (non-blocking). Excludes this request's own row and the
    // work_orders it spawned (they share its job_number) so only genuine duplicates show.
    store.woRequestDetailActiveWos.value = [];
    db.fetchActiveWosForPart(req.part_number).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        if (error) return; // fail-safe: no banner on lookup failure
        const wos = (data?.work_orders || []).filter(w =>
            !(req.job_number && w.job_number === req.job_number));
        const reqs = (data?.requests || []).filter(r => r.id !== req.id);
        store.woRequestDetailActiveWos.value = [
            ...wos.map(w => ({
                label:  w.wo_number || (w.job_number ? 'Job #' + w.job_number : 'WO'),
                detail: [w.department, w.status].filter(Boolean).join(' · '),
            })),
            ...reqs.map(r => ({ label: 'Request', detail: r.status })),
        ];
    });

    // Manual "Real Count" from item_master (non-blocking). Cleared synchronously so a
    // prior part's count never flashes; guarded by req.id against fast A→B opens.
    store.woRequestRealCount.value = null;
    db.fetchItemMasterByPart(req.part_number).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        if (error || !data || data.manual_qty_check == null) return;
        if (store.selectedWoRequest.value?.id !== req.id) return; // stale: a different request opened
        store.woRequestRealCount.value = { qty: data.manual_qty_check, date: data.date_manual_count };
    });

    // Auto-fill usage summary + last 3 made (non-blocking)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    store.woRequestHistoryLoading.value      = true;
    store.woRequestParentUsageLoading.value  = true;
    store.woRequestHistoryLoading36mo.value  = true;
    store.woRequestParentUsageLoading36mo.value = true;
    store.woRequestLastMade.value = [];
    store.woRequestSubparts.value = [];
    store.woRequestSubpartsLoading.value = true;
    store.woRequestSubpartsExpanded.value = false;
    if (req.subpart_plans) {
        const r = {};
        Object.entries(req.subpart_plans).forEach(([n, v]) => { r[n] = { ...v, expanded: false, defaultsLoaded: true }; });
        store.woRequestSubpartForms.value = r;
    }

    // Replacement chain (part_changes): resolved once, shared by the history
    // fetches below so sums include parts this one replaced. Falls back to
    // [self] so history still loads if the chain lookup fails.
    const norm = (req.part_number || '').trim().toUpperCase();
    store.woRequestCalcChain.value = null;
    const chainP = db.resolvePartCalcChain(req.part_number).then(({ data }) => {
        if (gen === _detailGen && data.links.length) store.woRequestCalcChain.value = data;
        return data.chain.length ? data.chain : [norm];
    });

    // 1yr: qty_used_in_mfg + qty_made from issues_receipts (rolling 12mo)
    chainP.then(chain => db.fetchPartUsageSummary12Mo(req.part_number, chain)).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestHistoryLoading.value = false;
        if (error) {
            store.showToast('Could not load part history: ' + error.message, 'error');
            logError('openWoRequestDetail:history', error, { part: req.part_number });
            return;
        }
        store.woRequestDetailForm.value.qty_used_in_mfg    = data.qty_used_in_mfg;
        store.woRequestDetailForm.value.qty_made_past_12mo = data.qty_made_past_12mo;
    });

    // 1yr: qty_sold from sales_analysis_lines (rolling 12mo, summed over the chain)
    chainP.then(chain => db.fetchQtySoldFromSalesAnalysis(chain, oneYearAgo, today).then(({ data: salesMap, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        if (error) { logError('openWoRequestDetail:qtySold1yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_used_12mo = chain.reduce((s, p) => s + (salesMap[p] || 0), 0);
    }));

    // 1yr: parent BOM demand (rolling 12mo)
    db.calculateRecursiveParentUsageDemand(req.part_number, oneYearAgo, today).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestParentUsageLoading.value = false;
        if (error) { logError('openWoRequestDetail:parentUsage1yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_parent_usage_period = data.totalDemand;
    });

    // 3yr: qty_used_in_mfg + qty_made from issues_receipts (since 1/1/23)
    chainP.then(chain => db.fetchPartUsageSummary36Mo(req.part_number, chain)).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestHistoryLoading36mo.value = false;
        if (error) { logError('openWoRequestDetail:history3yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_used_in_mfg_36mo = data.qty_used_in_mfg_36mo;
        store.woRequestDetailForm.value.qty_made_36mo        = data.qty_made_past_36mo;
    });

    // 3yr: qty_sold from sales_analysis_lines (since 1/1/23, summed over the chain)
    chainP.then(chain => db.fetchQtySoldFromSalesAnalysis(chain, PURCHASING_3YR_START, today).then(({ data: salesMap, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        if (error) { logError('openWoRequestDetail:qtySold3yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_36mo = chain.reduce((s, p) => s + (salesMap[p] || 0), 0);
    }));

    // 3yr: parent BOM demand (since 1/1/23)
    db.calculateRecursiveParentUsageDemand(req.part_number, PURCHASING_3YR_START, today).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestParentUsageLoading36mo.value = false;
        if (error) { logError('openWoRequestDetail:parentUsage3yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_parent_usage_36mo = data.totalDemand;
    });

    db.fetchPartLastMade(req.part_number).then(({ data }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestLastMade.value = data || [];
    });

    // "Used On" — BOM parents the requested part is a child of (all_boms).
    store.woRequestUsedOn.value = [];
    store.woRequestUsedOnLoading.value = true;
    db.fetchBomParentsForChild(req.part_number).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestUsedOnLoading.value = false;
        if (error) { logError('openWoRequestDetail:usedOn', error, { part: req.part_number }); return; }
        // Dedupe by parent part #, keeping qty_per_assy; sort for stable display.
        const seen = new Map();
        for (const r of (data || [])) {
            const part = r.item_parent_normalized;
            if (!part || seen.has(part)) continue;
            seen.set(part, Number(r.qty_per_assy) || 1);
        }
        store.woRequestUsedOn.value = [...seen.entries()]
            .map(([part, qty]) => ({ part, qty, desc: '' }))
            .sort((a, b) => a.part.localeCompare(b.part));
        // Fetch a description per parent part to show under the part # (fire-and-forget).
        const parentParts = store.woRequestUsedOn.value.map(p => p.part);
        if (parentParts.length > 0) {
            db.fetchBinAndDescForParts(parentParts).then(({ data: bd, error: bdErr }) => {
                if (gen !== _detailGen) return;    // stale: a newer detail opened
                if (bdErr) { logError('openWoRequestDetail:usedOnDesc', bdErr); return; }
                store.woRequestUsedOn.value = store.woRequestUsedOn.value
                    .map(p => ({ ...p, desc: bd.descs[p.part] || '' }));
            });
        }
    });
    db.fetchBomChildrenForParent(req.part_number).then(({ data, error }) => {
        if (gen !== _detailGen) return;    // stale: a newer detail opened
        store.woRequestSubpartsLoading.value = false;
        if (error) {
            logError('openWoRequestDetail:subparts', error, { part: req.part_number });
            return;
        }
        const subparts = data || [];
        store.woRequestSubparts.value = subparts;
        if (subparts.length > 0) {
            const normalized = subparts.map(s => s.item_child_normalized);
            db.fetchBinAndDescForParts(normalized).then(({ data: bd, error: bdErr }) => {
                if (gen !== _detailGen) return;    // stale: a newer detail opened
                if (bdErr) { logError('openWoRequestDetail:bins', bdErr); return; }
                store.woRequestSubpartBins.value  = bd.bins;
                store.woRequestSubpartDescs.value = bd.descs;
            });
            calcSubpartStats(subparts)
                .then(s => { if (gen === _detailGen) store.woRequestSubpartStats.value = s; })
                .catch(err => logError('openWoRequestDetail:subpartStats', err));
        }
    });

    // Auto-fill blank routing fields from stored part defaults (fire-and-forget safe).
    // Skipped entirely for assembly requests — their routing is fixed by the
    // assembly template above and must not be overwritten by part defaults.
    if (req.is_assembly) return;
    try {
        const { data: defaults } = await db.fetchPartApprovalDefault(req.part_number);
        if (gen !== _detailGen) return;    // stale: a newer detail opened during the await
        if (defaults) {
            const form   = store.woRequestDetailForm.value;
            const FIELDS = ['fab', 'fab_print', 'weld', 'weld_print', 'assy_wo', 'color'];
            let applied  = false;
            FIELDS.forEach(f => {
                if (!form[f] && defaults[f]) { form[f] = defaults[f]; applied = true; }
            });
            // bent_rolled_part: stored as BOOLEAN, form uses 'yes'/'no'
            if (!form.bent_rolled_part && defaults.bent_rolled_part !== null && defaults.bent_rolled_part !== undefined) {
                form.bent_rolled_part = defaults.bent_rolled_part ? 'yes' : 'no';
                applied = true;
            }
            store.woRequestDefaultsApplied.value = applied;
        }
    } catch (err) {
        logError('openWoRequestDetail:defaults', err, { part: req.part_number });
    }
}

// loadWoFilesForRequest — fetch part prints for the given part number into woFiles.
export async function loadWoFilesForRequest(partNumber) {
    if (!partNumber) { store.woFiles.value = []; return; }
    store.woFilesLoading.value = true;
    const { data, error } = await db.listWoFiles(partNumber);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Could not load files: ' + error.message); return; }
    store.woFiles.value = data || [];
}

// handleWoFileUploadForRequest — upload a file for the selected request's part number.
export async function handleWoFileUploadForRequest(event) {
    const file = event.target.files[0];
    const partNumber = store.selectedWoRequest.value?.part_number;
    if (!file || !partNumber) return;
    event.target.value = '';
    store.woFilesLoading.value = true;
    const { error } = await db.uploadWoFile(partNumber, file);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Upload failed: ' + error.message); return; }
    store.showToast('File uploaded.', 'success');
    await loadWoFilesForRequest(partNumber);
}

export function closeWoRequestDetail() {
    store.selectedWoRequest.value        = null;
    store.woRequestReadOnly.value        = false;
    store.woRequestDefaultsApplied.value = false;
    store.woRequestDetailActiveWos.value = [];
    store.woRequestSubparts.value         = [];
    store.woRequestSubpartsLoading.value  = false;
    store.woRequestSubpartsExpanded.value = false;
    store.woRequestSubpartBins.value      = {};
    store.woRequestSubpartDescs.value     = {};
    store.woRequestSubpartStats.value     = {};
    store.woRequestSubpartForms.value     = {};
    store.woRequestUsedOn.value           = [];
    store.woRequestUsedOnLoading.value    = false;
    store.woRequestRealCount.value        = null;
    store.woRequestSubpartStack.value     = [];
    store.woRequestMarkAllSubparts.value  = false;
}

// ── Subpart inspect (drill-in) ──────────────────────────────────────────────
// Clicking a BOM subpart reuses the SAME detail modal for that subpart. The parent
// context is snapshotted onto woRequestSubpartStack so Done/Cancel restore it exactly
// (no reload, no lost edits); the generation guard cancels in-flight subpart loads.

// _captureDetailSnapshot — snapshot the refs openWoRequestDetail owns. Safe to hold the
// references: the next open replaces values wholesale rather than mutating in place.
function _captureDetailSnapshot() {
    return {
        selectedWoRequest:        store.selectedWoRequest.value,
        woRequestReadOnly:        store.woRequestReadOnly.value,
        woRequestDefaultsApplied: store.woRequestDefaultsApplied.value,
        detailForm:               store.woRequestDetailForm.value,
        detailActiveWos:          store.woRequestDetailActiveWos.value,
        realCount:                store.woRequestRealCount.value,
        lastMade:                 store.woRequestLastMade.value,
        subparts:                 store.woRequestSubparts.value,
        subpartsExpanded:         store.woRequestSubpartsExpanded.value,
        subpartForms:             store.woRequestSubpartForms.value,
        subpartBins:              store.woRequestSubpartBins.value,
        subpartDescs:             store.woRequestSubpartDescs.value,
        subpartStats:             store.woRequestSubpartStats.value,
        usedOn:                   store.woRequestUsedOn.value,
        woFiles:                  store.woFiles.value,
    };
}

// _restoreDetailSnapshot — put a captured parent context back; bumps the generation so
// any still-pending subpart loads bail instead of clobbering it.
function _restoreDetailSnapshot(s) {
    _detailGen++;
    store.selectedWoRequest.value         = s.selectedWoRequest;
    store.woRequestReadOnly.value         = s.woRequestReadOnly;
    store.woRequestDefaultsApplied.value  = s.woRequestDefaultsApplied;
    store.woRequestDetailForm.value       = s.detailForm;
    store.woRequestDetailActiveWos.value  = s.detailActiveWos;
    store.woRequestRealCount.value        = s.realCount;
    store.woRequestLastMade.value         = s.lastMade;
    store.woRequestSubparts.value         = s.subparts;
    store.woRequestSubpartsExpanded.value = s.subpartsExpanded;
    store.woRequestSubpartForms.value     = s.subpartForms;
    store.woRequestSubpartBins.value      = s.subpartBins;
    store.woRequestSubpartDescs.value     = s.subpartDescs;
    store.woRequestSubpartStats.value     = s.subpartStats;
    store.woRequestUsedOn.value           = s.usedOn;
    store.woFiles.value                   = s.woFiles;
    store.woRequestUsedOnLoading.value    = false;
    store.woRequestSubpartsLoading.value  = false;
    store.woFilesLoading.value            = false;
}

// _detailFormToSubpartPlan — map the detail form back to the compact subpart-plan shape.
function _detailFormToSubpartPlan(f) {
    return {
        expanded: false,
        defaultsLoaded: true,
        qty_to_make:         f.qty_to_make         ?? '',
        fab:                 f.fab                 || '',
        fab_print:           f.fab_print           || '',
        weld:                f.weld                || '',
        weld_print:          f.weld_print          || '',
        assy_wo:             f.assy_wo             || '',
        color:               f.color               || '',
        bent_rolled_part:    f.bent_rolled_part    || '',
        date_to_start:       f.date_to_start       || '',
        estimated_lead_time: f.estimated_lead_time ?? '',
        set_up_time:         f.set_up_time         ?? '',
    };
}

// inspectSubpart — drill into a BOM subpart: snapshot the parent, seed a pseudo-request
// from the subpart + any plan already entered, then reuse openWoRequestDetail to load it.
export async function inspectSubpart(sub) {
    const key = sub.item_child_normalized;
    store.woRequestMarkAllSubparts.value = false;   // each drill starts unchecked
    const snap = _captureDetailSnapshot();
    snap.subpartKey  = key;
    snap.subpartPart = store.selectedWoRequest.value?.part_number || '';
    store.woRequestSubpartStack.value = [...store.woRequestSubpartStack.value, snap];

    const plan = store.woRequestSubpartForms.value[key] || {};
    const pseudo = {
        id: null,
        part_number:  sub.item_child,
        description:  store.woRequestSubpartDescs.value[key] || '',
        status:       'subpart',
        is_assembly:  false,
        job_number:   null,
        subpart_plans: null,
        qty_in_stock: null,
        qty_to_make:         plan.qty_to_make         ?? '',
        fab:                 plan.fab                 || '',
        fab_print:           plan.fab_print           || '',
        weld:                plan.weld                || '',
        weld_print:          plan.weld_print          || '',
        assy_wo:             plan.assy_wo             || '',
        color:               plan.color               || '',
        bent_rolled_part:    plan.bent_rolled_part === 'yes' ? true : plan.bent_rolled_part === 'no' ? false : null,
        date_to_start:       plan.date_to_start       || '',
        estimated_lead_time: plan.estimated_lead_time ?? '',
        set_up_time:         plan.set_up_time         ?? '',
    };
    // Clear the child level's subpart state so the parent's lists don't bleed through
    // before this part's BOM children load.
    store.woRequestSubpartForms.value = {};
    store.woRequestSubpartBins.value  = {};
    store.woRequestSubpartDescs.value = {};
    store.woRequestSubpartStats.value = {};
    await openWoRequestDetail(pseudo);
}

// _SUBPART_PLAN_FIELDS — the data fields copied between subparts (excludes UI flags).
const _SUBPART_PLAN_FIELDS = ['qty_to_make', 'fab', 'fab_print', 'weld', 'weld_print',
    'assy_wo', 'color', 'bent_rolled_part', 'date_to_start', 'estimated_lead_time', 'set_up_time'];
// _isBlankPlanValue — empty string / null / undefined = "not filled yet".
const _isBlankPlanValue = (v) => v === '' || v == null;

// finishSubpartInspect — "Done": write the inspected subpart's plan back to the parent
// map, restore the parent, pop the stack. With "mark all" ticked, also fill every other
// subpart's still-blank fields from this one (never overwrites customized values).
export function finishSubpartInspect() {
    const stack = store.woRequestSubpartStack.value;
    if (!stack.length) return;
    const snap = stack[stack.length - 1];
    const subForm = _detailFormToSubpartPlan(store.woRequestDetailForm.value);
    const markAll = store.woRequestMarkAllSubparts.value;

    _restoreDetailSnapshot(snap);
    store.woRequestSubpartStack.value = stack.slice(0, -1);

    const forms = { ...store.woRequestSubpartForms.value };
    forms[snap.subpartKey] = { ...(forms[snap.subpartKey] || {}), ...subForm };

    if (markAll) {
        // Fill blank fields of every other sibling subpart with this one's values.
        for (const sib of (snap.subparts || [])) {
            const k = sib.item_child_normalized;
            if (k === snap.subpartKey) continue;
            const target = { expanded: false, defaultsLoaded: true, ...(forms[k] || {}) };
            for (const f of _SUBPART_PLAN_FIELDS) {
                if (_isBlankPlanValue(target[f])) target[f] = subForm[f];
            }
            forms[k] = target;
        }
    }
    store.woRequestSubpartForms.value = forms;
    store.woRequestMarkAllSubparts.value = false;
}

// cancelSubpartInspect — discard the inspected subpart's edits and return to the parent.
export function cancelSubpartInspect() {
    const stack = store.woRequestSubpartStack.value;
    if (!stack.length) return;
    _restoreDetailSnapshot(stack[stack.length - 1]);
    store.woRequestSubpartStack.value = stack.slice(0, -1);
    store.woRequestMarkAllSubparts.value = false;
}

// dismissWoRequestDetail — the modal's X / backdrop handler. Pops one subpart level
// (discarding edits) while drilled in; closes the whole modal at the top level.
export function dismissWoRequestDetail() {
    if (store.woRequestSubpartStack.value.length) cancelSubpartInspect();
    else closeWoRequestDetail();
}
