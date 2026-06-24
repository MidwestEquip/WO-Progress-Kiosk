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

// boolToYesNo — maps a boolean DB value to 'yes'/'no'/'' for dropdown binding.
function boolToYesNo(val) {
    if (val === true)  return 'yes';
    if (val === false) return 'no';
    return '';
}

const SUBPART_FORM_BLANK = () => ({ expanded: false, defaultsLoaded: false, qty_to_make: '', fab: '', fab_print: '', weld: '', weld_print: '', assy_wo: '', color: '', bent_rolled_part: '', date_to_start: '', estimated_lead_time: '', set_up_time: '' });

// openSubpartWoForm — toggle inline WO form for a subpart row; auto-fills defaults on first open.
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

    // 1yr: qty_used_in_mfg + qty_made from issues_receipts (rolling 12mo)
    db.fetchPartUsageSummary12Mo(req.part_number).then(({ data, error }) => {
        store.woRequestHistoryLoading.value = false;
        if (error) {
            store.showToast('Could not load part history: ' + error.message, 'error');
            logError('openWoRequestDetail:history', error, { part: req.part_number });
            return;
        }
        store.woRequestDetailForm.value.qty_used_in_mfg    = data.qty_used_in_mfg;
        store.woRequestDetailForm.value.qty_made_past_12mo = data.qty_made_past_12mo;
    });

    // 1yr: qty_sold from sales_analysis_lines (rolling 12mo)
    const norm = (req.part_number || '').trim().toUpperCase();
    db.fetchQtySoldFromSalesAnalysis([req.part_number], oneYearAgo, today).then(({ data: salesMap, error }) => {
        if (error) { logError('openWoRequestDetail:qtySold1yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_used_12mo = salesMap[norm] || 0;
    });

    // 1yr: parent BOM demand (rolling 12mo)
    db.calculateRecursiveParentUsageDemand(req.part_number, oneYearAgo, today).then(({ data, error }) => {
        store.woRequestParentUsageLoading.value = false;
        if (error) { logError('openWoRequestDetail:parentUsage1yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_parent_usage_period = data.totalDemand;
    });

    // 3yr: qty_used_in_mfg + qty_made from issues_receipts (since 1/1/23)
    db.fetchPartUsageSummary36Mo(req.part_number).then(({ data, error }) => {
        store.woRequestHistoryLoading36mo.value = false;
        if (error) { logError('openWoRequestDetail:history3yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_used_in_mfg_36mo = data.qty_used_in_mfg_36mo;
        store.woRequestDetailForm.value.qty_made_36mo        = data.qty_made_past_36mo;
    });

    // 3yr: qty_sold from sales_analysis_lines (since 1/1/23)
    db.fetchQtySoldFromSalesAnalysis([req.part_number], PURCHASING_3YR_START, today).then(({ data: salesMap, error }) => {
        if (error) { logError('openWoRequestDetail:qtySold3yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_36mo = salesMap[norm] || 0;
    });

    // 3yr: parent BOM demand (since 1/1/23)
    db.calculateRecursiveParentUsageDemand(req.part_number, PURCHASING_3YR_START, today).then(({ data, error }) => {
        store.woRequestParentUsageLoading36mo.value = false;
        if (error) { logError('openWoRequestDetail:parentUsage3yr', error, { part: req.part_number }); return; }
        store.woRequestDetailForm.value.qty_sold_parent_usage_36mo = data.totalDemand;
    });

    db.fetchPartLastMade(req.part_number).then(({ data }) => {
        store.woRequestLastMade.value = data || [];
    });

    // "Used On" — BOM parents the requested part is a child of (all_boms).
    store.woRequestUsedOn.value = [];
    store.woRequestUsedOnLoading.value = true;
    db.fetchBomParentsForChild(req.part_number).then(({ data, error }) => {
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
                if (bdErr) { logError('openWoRequestDetail:usedOnDesc', bdErr); return; }
                store.woRequestUsedOn.value = store.woRequestUsedOn.value
                    .map(p => ({ ...p, desc: bd.descs[p.part] || '' }));
            });
        }
    });
    db.fetchBomChildrenForParent(req.part_number).then(({ data, error }) => {
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
                if (bdErr) { logError('openWoRequestDetail:bins', bdErr); return; }
                store.woRequestSubpartBins.value  = bd.bins;
                store.woRequestSubpartDescs.value = bd.descs;
            });
            calcSubpartStats(subparts)
                .then(s => { store.woRequestSubpartStats.value = s; })
                .catch(err => logError('openWoRequestDetail:subpartStats', err));
        }
    });

    // Auto-fill blank routing fields from stored part defaults (fire-and-forget safe).
    // Skipped entirely for assembly requests — their routing is fixed by the
    // assembly template above and must not be overwritten by part defaults.
    if (req.is_assembly) return;
    try {
        const { data: defaults } = await db.fetchPartApprovalDefault(req.part_number);
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
    store.woRequestSubparts.value         = [];
    store.woRequestSubpartsLoading.value  = false;
    store.woRequestSubpartsExpanded.value = false;
    store.woRequestSubpartBins.value      = {};
    store.woRequestSubpartDescs.value     = {};
    store.woRequestSubpartStats.value     = {};
    store.woRequestSubpartForms.value     = {};
    store.woRequestUsedOn.value           = [];
    store.woRequestUsedOnLoading.value    = false;
}
