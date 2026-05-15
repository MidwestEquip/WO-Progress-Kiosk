// ============================================================
// pages/wo-request-view.js — WO Request form logic
//
// Handles: loading requests, submitting, inline field saves,
//          selecting for detail editing, save, approve.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// checkWoRequestPartMatch — on blur of Part # field, query open_orders for a row
// with the same part number and a non-null sales_order. Sets woRequestSoHint if found.
export async function checkWoRequestPartMatch() {
    const part = (store.woRequestForm.value.part_number || '').trim().toUpperCase();
    if (!part) { store.woRequestSoHint.value = null; return; }
    const { data } = await db.findOpenOrdersByPartNumber(part);
    const match = (data || []).find(o => o.sales_order);
    store.woRequestSoHint.value = match
        ? { salesOrder: match.sales_order, qty: match.to_ship, partNumber: match.part_number }
        : null;
}

// acceptSoHint — copies the hinted SO# into the WO Request form and clears the hint.
export function acceptSoHint() {
    const hint = store.woRequestSoHint.value;
    if (!hint) return;
    store.woRequestForm.value = { ...store.woRequestForm.value, sales_order_number: hint.salesOrder };
    store.woRequestSoHint.value = null;
}

// dismissSoHint — discards the hint without applying it.
export function dismissSoHint() {
    store.woRequestSoHint.value = null;
}

// loadWoRequests — fetch all requests (oldest first) and populate store + inline state.
export async function loadWoRequests() {
    store.woRequestsLoading.value = true;
    try {
        const { data, error } = await db.fetchWoRequests();
        if (error) throw error;
        const rows = data || [];
        store.woRequests.value = rows;
        // Populate inline editable state for each row (preserve existing input if still present)
        const prev  = store.woRequestInlineState.value;
        const state = {};
        rows.forEach(r => {
            state[r.id] = {
                alere_qty:          (prev[r.id]?.alere_qty          ?? '') !== '' ? prev[r.id].alere_qty          : (r.alere_qty          ?? ''),
                alere_bin:          (prev[r.id]?.alere_bin          ?? '') !== '' ? prev[r.id].alere_bin          : (r.alere_bin          || ''),
                qty_sold_used_12mo: (prev[r.id]?.qty_sold_used_12mo ?? '') !== '' ? prev[r.id].qty_sold_used_12mo : (r.qty_sold_used_12mo ?? ''),
                where_used:         (prev[r.id]?.where_used         ?? '') !== '' ? prev[r.id].where_used         : (r.where_used         || ''),
            };
        });
        store.woRequestInlineState.value = state;
    } catch (err) {
        store.showToast('Failed to load WO requests: ' + err.message);
        logError('loadWoRequests', err);
        store.woRequests.value = [];
    } finally {
        store.woRequestsLoading.value = false;
    }
}

// resetWoRequestForm — clear the submission form and validation errors.
export function resetWoRequestForm() {
    store.woRequestForm.value = {
        part_number: '', description: '', sales_order_number: '',
        qty_on_order: '', qty_in_stock: '', qty_used_per_unit: '',
        submitted_by: ''
    };
    store.woRequestFormErrors.value = { part_number: false, qty_in_stock: false, qty_used_per_unit: false, submitted_by: false };
}

// submitWoRequestForm — validate, insert new request, reload list.
export async function submitWoRequestForm() {
    const form   = store.woRequestForm.value;
    const errors = { part_number: false, qty_in_stock: false, qty_used_per_unit: false, submitted_by: false };
    if (!form.part_number.trim())                                      errors.part_number      = true;
    if (form.qty_in_stock === ''     || form.qty_in_stock     == null) errors.qty_in_stock     = true;
    if (form.qty_used_per_unit === '' || form.qty_used_per_unit == null) errors.qty_used_per_unit = true;
    if (!form.submitted_by.trim())                                     errors.submitted_by     = true;
    store.woRequestFormErrors.value = errors;
    if (errors.part_number || errors.qty_in_stock || errors.qty_used_per_unit || errors.submitted_by) return;

    store.loading.value = true;
    try {
        const { error } = await db.submitWoRequest(form);
        if (error) throw error;

        // Sync open order status → 'WO Requested' if SO# + Part# match
        const soNum = (form.sales_order_number || '').trim();
        const part  = (form.part_number || '').trim().toUpperCase();
        if (soNum && part) {
            const { data: oo } = await db.findOpenOrderBySoAndPart(soNum, part);
            if (oo && oo.status !== 'WO Requested' && oo.status !== 'WO Created') {
                await db.updateOpenOrder(oo.id, { status: 'WO Requested', last_status_update: new Date().toISOString() });
            }
        }

        resetWoRequestForm();
        store.showToast('WO request submitted.', 'success');
        await loadWoRequests();
    } catch (err) {
        store.showToast('Failed to submit request: ' + err.message, 'error');
        logError('submitWoRequestForm', err);
    } finally {
        store.loading.value = false;
    }
}

// saveWoRequestInlineFields — silently save the 4 inline card fields for a request row.
// Called on @blur of any inline input. Updates the list item in place so the modal
// sees fresh values if opened immediately after.
export async function saveWoRequestInlineFields(id) {
    const s = store.woRequestInlineState.value[id];
    if (!s) return;
    const updates = {
        alere_qty:          s.alere_qty          !== '' ? parseFloat(s.alere_qty)          : null,
        alere_bin:          (s.alere_bin || '').trim()  || null,
        qty_sold_used_12mo: s.qty_sold_used_12mo  !== '' ? parseFloat(s.qty_sold_used_12mo) : null,
        where_used:         (s.where_used || '').trim()  || null,
    };
    try {
        const { error } = await db.updateWoRequest(id, updates);
        if (error) throw error;
        // Update item in place so the modal reads fresh data if opened next
        const idx = store.woRequests.value.findIndex(r => r.id === id);
        if (idx !== -1) {
            store.woRequests.value[idx] = { ...store.woRequests.value[idx], ...updates };
        }
    } catch (err) {
        store.showToast('Failed to save: ' + err.message, 'error');
        logError('saveWoRequestInlineFields', err, { id });
    }
}

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
    store.woRequestDetailForm.value = {
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
        date_to_start:       req.date_to_start       || '',
        production_notes:    req.production_notes    || '',
        staging_area:        req.staging_area        || ''
    };
    loadWoFilesForRequest(req.part_number);

    // Auto-fill usage summary + last 2 made (non-blocking)
    store.woRequestHistoryLoading.value = true;
    store.woRequestParentUsageLoading.value = true;
    store.woRequestLastMade.value = [];
    store.woRequestSubparts.value = [];
    store.woRequestSubpartsLoading.value = true;
    store.woRequestSubpartsExpanded.value = false;
    if (req.subpart_plans) {
        const r = {};
        Object.entries(req.subpart_plans).forEach(([n, v]) => { r[n] = { ...v, expanded: false, defaultsLoaded: true }; });
        store.woRequestSubpartForms.value = r;
    }

    // qty_used_in_mfg + qty_made_past_12mo from issues_receipts (manufacturing data)
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

    // qty_sold_used_12mo from sales_analysis_lines (sales data)
    db.fetchQtySoldFromSalesAnalysis([req.part_number]).then(({ data: salesMap, error }) => {
        if (error) {
            logError('openWoRequestDetail:qtySold', error, { part: req.part_number });
            return;
        }
        const norm = (req.part_number || '').trim().toUpperCase();
        store.woRequestDetailForm.value.qty_sold_used_12mo = salesMap[norm] || 0;
    });
    db.fetchPartLastMade(req.part_number).then(({ data }) => {
        store.woRequestLastMade.value = data || [];
    });
    db.calculateRecursiveParentUsageDemand(req.part_number).then(({ data, error }) => {
        store.woRequestParentUsageLoading.value = false;
        if (error) {
            logError('openWoRequestDetail:parentUsage', error, { part: req.part_number });
            return;
        }
        store.woRequestDetailForm.value.qty_sold_parent_usage_period = data.totalDemand;
        console.debug('[BOM rollup]', req.part_number, data);
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

    // Auto-fill blank routing fields from stored part defaults (fire-and-forget safe)
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
}


// _buildDetailUpdates — shared helper to convert the detail form to DB update shape.
function _buildDetailUpdates(form) {
    return {
        alere_qty:                    form.alere_qty                     !== '' ? parseFloat(form.alere_qty)                     : null,
        qty_sold_used_12mo:           form.qty_sold_used_12mo            !== '' ? parseFloat(form.qty_sold_used_12mo)            : null,
        qty_sold_parent_usage_period: form.qty_sold_parent_usage_period  !== '' ? parseFloat(form.qty_sold_parent_usage_period)  : null,
        qty_used_in_mfg:              form.qty_used_in_mfg               !== '' ? parseFloat(form.qty_used_in_mfg)               : null,
        qty_made_past_12mo:           form.qty_made_past_12mo            !== '' ? parseFloat(form.qty_made_past_12mo)            : null,
        where_used:          form.where_used.trim()  || null,
        qty_to_make:         form.qty_to_make        !== '' ? parseFloat(form.qty_to_make)        : null,
        fab:                 form.fab      || null,   // TEXT 'yes'/'no'
        fab_print:           form.fab_print || null,
        weld:                form.weld                || null,   // TEXT area name
        weld_print:          form.weld_print          || null,
        assy_wo:             form.assy_wo             || null,
        color:               form.color.trim()        || null,
        bent_rolled_part:    form.bent_rolled_part === 'yes' ? true : form.bent_rolled_part === 'no' ? false : null,
        set_up_time:         form.set_up_time         !== '' ? parseFloat(form.set_up_time)        : null,
        alere_bin:           form.alere_bin.trim()    || null,
        estimated_lead_time: form.estimated_lead_time !== '' ? parseFloat(form.estimated_lead_time): null,
        sent_to_production:  form.sent_to_production,
        date_to_start:       form.date_to_start       || null,
        production_notes:    form.production_notes.trim() || null,
        staging_area:        form.staging_area         || null,
    };
}

// _syncAfterSave — reload list and re-sync selectedWoRequest after a detail save.
async function _syncAfterSave(id) {
    await loadWoRequests();
    const updated = store.woRequests.value.find(r => r.id === id);
    if (updated) store.selectedWoRequest.value = updated;
}

// saveWoRequestDetail — save manager fields without changing status.
export async function saveWoRequestDetail() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;

    store.loading.value = true;
    try {
        const plans = {};
        Object.entries(store.woRequestSubpartForms.value).forEach(([n, { expanded, defaultsLoaded, ...d }]) => { plans[n] = d; });
        const { error } = await db.updateWoRequest(id, { ..._buildDetailUpdates(form), subpart_plans: Object.keys(plans).length ? plans : null });
        if (error) throw error;
        store.showToast('Saved.', 'success');
        await _syncAfterSave(id);
    } catch (err) {
        store.showToast('Failed to save: ' + err.message, 'error');
        logError('saveWoRequestDetail', err, { id });
    } finally {
        store.loading.value = false;
    }
}

// approveWoRequest — validate all 10 required production fields, assign job #, set status='in production',
// and create work_orders immediately using JOB-{n} as the internal wo_number placeholder.
// Required: qty_to_make, estimated_lead_time, date_to_start, weld, weld_print,
//           fab, fab_print, bent_rolled_part, set_up_time, assy_wo.
export async function approveWoRequest() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;

    const missing = [];
    if (form.qty_to_make        === '' || form.qty_to_make        == null) missing.push('Qty to Make');
    if (form.estimated_lead_time === '' || form.estimated_lead_time == null) missing.push('Est. Lead Time');
    if (!form.date_to_start)                                                missing.push('Date to Start');
    if (!form.weld)                                                         missing.push('Weld');
    if (!form.weld_print)                                                   missing.push('Weld Print');
    if (!form.fab)                                                          missing.push('Fab');
    if (!form.fab_print)                                                    missing.push('Fab Print');
    if (!form.bent_rolled_part)                                             missing.push('Bent / Rolled Part');
    if (form.set_up_time        === '' || form.set_up_time        == null) missing.push('Set Up Time');
    if (!form.assy_wo)                                                      missing.push('Assy WO');
    if (!form.staging_area)                                                 missing.push('Staging Area');

    if (missing.length > 0) {
        store.showToast('Missing required: ' + missing.join(', '), 'error', 7000);
        return;
    }

    store.loading.value = true;
    try {
        // Assign job number before saving — RPC is idempotent; safe to retry on re-approve
        const { data: jobNumber, error: jobErr } = await db.assignJobNumberIfMissing(id);
        if (jobErr) throw jobErr;

        const today   = new Date().toISOString().slice(0, 10);
        const updates = { ..._buildDetailUpdates(form), status: 'in production', created_date: today };
        const { error } = await db.updateWoRequest(id, updates);
        if (error) throw error;

        // Create work_orders immediately — JOB-{n} is the internal placeholder until official WO# is set
        const req = store.selectedWoRequest.value;
        const approvalReq = {
            id:                 req.id,
            part_number:        req.part_number,
            description:        req.description,
            sales_order_number: req.sales_order_number,
            traveller_id:       req.traveller_id,
            job_number:         jobNumber,
            qty_to_make:        updates.qty_to_make,
            fab:                updates.fab,
            fab_print:          updates.fab_print,
            weld:               updates.weld,
            weld_print:         updates.weld_print,
            assy_wo:            updates.assy_wo,
            production_notes:   updates.production_notes,
            staging_area:       updates.staging_area,
        };
        const { error: routeErr } = await db.insertWorkOrdersFromRequest(approvalReq);
        if (routeErr) throw routeErr;

        // Fire-and-forget: learn routing defaults for this part (never blocks approval)
        const partNum = (store.selectedWoRequest.value?.part_number || '').trim();
        if (partNum) {
            db.learnPartApprovalDefaults(partNum, {
                fab:              updates.fab,
                fab_print:        updates.fab_print,
                weld:             updates.weld,
                weld_print:       updates.weld_print,
                assy_wo:          updates.assy_wo,
                color:            updates.color,
                bent_rolled_part: updates.bent_rolled_part,
            }).catch(err => logError('approveWoRequest:learnDefaults', err, { part: partNum }));
        }

        // Sync est. lead time as a date to the matching open order's Est. Leadtime column
        const leadDays = parseFloat(form.estimated_lead_time);
        const soNum    = (req.sales_order_number || '').trim();
        const part     = (req.part_number        || '').trim().toUpperCase();
        if (soNum && part && leadDays > 0) {
            const { data: oo } = await db.findOpenOrderBySoAndPart(soNum, part);
            if (oo) {
                const leadDate = new Date();
                leadDate.setDate(leadDate.getDate() + leadDays);
                await db.updateOpenOrder(oo.id, { deadline: leadDate.toISOString().split('T')[0] });
            }
        }

        // Traveller: create group + subpart requests for weld WOs with filled subpart forms
        const subpartEntries = Object.entries(store.woRequestSubpartForms.value)
            .filter(([, f]) => parseFloat(f.qty_to_make) > 0);
        if (store.woRequestSubpartMode.value === 'weld' && subpartEntries.length > 0) {
            const { data: trav, error: tErr } = await db.insertTraveller();
            if (tErr) throw tErr;
            await db.updateWoRequest(id, { traveller_id: trav.id });
            const descs = store.woRequestSubpartDescs.value;
            const today = new Date().toISOString().split('T')[0];
            const subRows = subpartEntries.map(([n, f]) => {
                const sub = store.woRequestSubparts.value.find(s => s.item_child_normalized === n);
                return {
                    part_number:         (sub?.item_child || n).trim().toUpperCase(),
                    description:         descs[n] || '',
                    qty_to_make:         parseFloat(f.qty_to_make),
                    fab:                 f.fab          || null,
                    fab_print:           f.fab_print     || null,
                    weld:                f.weld          || null,
                    weld_print:          f.weld_print    || null,
                    assy_wo:             f.assy_wo       || null,
                    color:               f.color         || null,
                    bent_rolled_part:    f.bent_rolled_part === 'yes' ? true : f.bent_rolled_part === 'no' ? false : null,
                    date_to_start:       f.date_to_start || null,
                    estimated_lead_time: f.estimated_lead_time !== '' ? parseFloat(f.estimated_lead_time) : null,
                    set_up_time:         f.set_up_time   !== '' ? parseFloat(f.set_up_time) : null,
                    traveller_id:        trav.id,
                    parent_request_id:   id,
                    status:              'approved',
                    submitted_by:        'System',
                    request_date:        today,
                };
            });
            const { data: subData, error: subErr } = await db.batchInsertWoRequests(subRows);
            if (subErr) throw subErr;

            // Assign job numbers and create work_orders for each subpart immediately
            await Promise.all((subData || []).map(async sub => {
                const { data: subJobNum, error: sjErr } = await db.assignJobNumberIfMissing(sub.id);
                if (sjErr) { logError('approveWoRequest:subJobNum', sjErr, { id: sub.id }); return; }
                const { error: swErr } = await db.insertWorkOrdersFromRequest({ ...sub, job_number: subJobNum });
                if (swErr) logError('approveWoRequest:subWorkOrders', swErr, { id: sub.id });
            }));
        }

        store.showToast('Approved — Job #' + jobNumber + ' in production.', 'success');
        await _syncAfterSave(id);
    } catch (err) {
        store.showToast('Failed to approve: ' + err.message, 'error');
        logError('approveWoRequest', err, { id });
    } finally {
        store.loading.value = false;
    }
}

// openSendToForecast — open the send-to-forecast form for a request row.
export function openSendToForecast(req) {
    store.sendToForecastTarget.value = req;
    store.sendToForecastForm.value   = { forecast_date: '', forecast_reason: '' };
    store.sendToForecastErrors.value = { forecast_date: false, forecast_reason: false };
    store.sendToForecastOpen.value   = true;
}

// closeSendToForecast — close the modal without saving.
export function closeSendToForecast() {
    store.sendToForecastOpen.value   = false;
    store.sendToForecastTarget.value = null;
}

// submitSendToForecast — validate, mark record as forecasted, close modal.
export async function submitSendToForecast() {
    const form   = store.sendToForecastForm.value;
    const target = store.sendToForecastTarget.value;
    if (!target) return;

    const errors = { forecast_date: !form.forecast_date, forecast_reason: !form.forecast_reason.trim() };
    store.sendToForecastErrors.value = errors;
    if (errors.forecast_date || errors.forecast_reason) return;

    store.loading.value = true;
    try {
        const { error } = await db.updateWoRequest(target.id, {
            forecasted:      true,
            forecast_date:   form.forecast_date,
            forecast_reason: form.forecast_reason.trim(),
        });
        if (error) throw error;
        store.showToast('Moved to WO Forecasting.', 'success');
        closeSendToForecast();
        store.selectedWoRequest.value = null;
        await loadWoRequests();
    } catch (err) {
        store.showToast('Failed to forecast: ' + err.message, 'error');
        logError('submitSendToForecast', err, { id: target.id });
    } finally {
        store.loading.value = false;
    }
}

// deleteWoRequestItem — confirm then hard-delete a request.
export async function deleteWoRequestItem(id) {
    if (!confirm('Delete this request? This cannot be undone.')) return;
    if (store.selectedWoRequest.value?.id === id) store.selectedWoRequest.value = null;
    store.loading.value = true;
    try {
        const { error } = await db.deleteWoRequest(id);
        if (error) throw error;
        store.showToast('Request deleted.', 'success');
        await loadWoRequests();
    } catch (err) {
        store.showToast('Failed to delete request: ' + err.message, 'error');
        logError('deleteWoRequestItem', err, { id });
    } finally {
        store.loading.value = false;
    }
}
