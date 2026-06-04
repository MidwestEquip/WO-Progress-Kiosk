// ============================================================
// pages/wo-manager-approval.js — Manager WO final approval logic
//
// Handles: PIN auth, loading pending requests, detail view,
//          save routing edits, final approve, send back to planner.
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// enterWoApprovalView — navigate to the WO approval view and load the queue.
export function enterWoApprovalView() {
    closeManagerWoDetail();
    store.currentView.value = 'wo_approval';
    loadManagerPendingWoRequests();
}

// exitWoApprovalView — navigate back to splash (preserves splash level/category state).
export function exitWoApprovalView() {
    closeManagerWoDetail();
    store.currentView.value = 'splash';
}

// loadManagerPendingWoRequests — fetch all status='manager_review' requests into store.
export async function loadManagerPendingWoRequests() {
    store.managerWoApprovalLoading.value = true;
    try {
        const { data, error } = await db.fetchManagerPendingWoRequests();
        if (error) throw error;
        store.managerWoApprovalList.value = data || [];
    } catch (err) {
        store.showToast('Failed to load WO approval queue: ' + err.message, 'error');
        logError('loadManagerPendingWoRequests', err);
    } finally {
        store.managerWoApprovalLoading.value = false;
    }
}

// _boolToYesNo — maps boolean DB value to 'yes'/'no'/'' for <select> binding.
function _boolToYesNo(val) {
    if (val === true)  return 'yes';
    if (val === false) return 'no';
    return '';
}

// openManagerWoDetail — populate the manager detail form from a request row.
export function openManagerWoDetail(req) {
    store.managerWoSelectedRequest.value = req;
    store.managerWoSendBackOpen.value    = false;
    store.managerWoSendBackNote.value    = '';
    store.managerWoDetailForm.value = {
        qty_to_make:         req.qty_to_make         ?? '',
        estimated_lead_time: req.estimated_lead_time ?? '',
        date_to_start:       req.date_to_start       || '',
        fab:                 req.fab                 || '',
        fab_print:           req.fab_print           || '',
        weld:                req.weld                || '',
        weld_print:          req.weld_print          || '',
        assy_wo:             req.assy_wo             || '',
        color:               req.color               || '',
        bent_rolled_part:    _boolToYesNo(req.bent_rolled_part),
        set_up_time:         req.set_up_time         ?? '',
        alere_bin:           req.alere_bin           || '',
        staging_area:        req.staging_area        || '',
        production_notes:    req.production_notes    || '',
    };
}

// closeManagerWoDetail — deselect the request and reset panel state.
export function closeManagerWoDetail() {
    store.managerWoSelectedRequest.value = null;
    store.managerWoDetailForm.value      = {};
    store.managerWoSendBackOpen.value    = false;
    store.managerWoSendBackNote.value    = '';
}

// _buildUpdates — convert the manager detail form to DB update shape.
function _buildUpdates(form) {
    return {
        qty_to_make:         form.qty_to_make         !== '' ? parseFloat(form.qty_to_make)         : null,
        estimated_lead_time: form.estimated_lead_time !== '' ? parseFloat(form.estimated_lead_time) : null,
        date_to_start:       form.date_to_start       || null,
        fab:                 form.fab                 || null,
        fab_print:           form.fab_print           || null,
        weld:                form.weld                || null,
        weld_print:          form.weld_print          || null,
        assy_wo:             form.assy_wo             || null,
        color:               (form.color              || '').trim() || null,
        bent_rolled_part:    form.bent_rolled_part === 'yes' ? true : form.bent_rolled_part === 'no' ? false : null,
        set_up_time:         form.set_up_time         !== '' ? parseFloat(form.set_up_time)         : null,
        alere_bin:           (form.alere_bin          || '').trim() || null,
        staging_area:        form.staging_area        || null,
        production_notes:    (form.production_notes   || '').trim() || null,
    };
}

// _syncList — reload list and update selectedRequest with the refreshed row.
async function _syncList(id) {
    await loadManagerPendingWoRequests();
    const updated = store.managerWoApprovalList.value.find(r => r.id === id);
    if (updated) store.managerWoSelectedRequest.value = updated;
}

// saveManagerWoDetail — save revised routing fields without changing status.
export async function saveManagerWoDetail() {
    const id   = store.managerWoSelectedRequest.value?.id;
    const form = store.managerWoDetailForm.value;
    if (!id) return;
    store.loading.value = true;
    try {
        const { error } = await db.updateWoRequest(id, _buildUpdates(form));
        if (error) throw error;
        store.showToast('Saved.', 'success');
        await _syncList(id);
    } catch (err) {
        store.showToast('Failed to save: ' + err.message, 'error');
        logError('saveManagerWoDetail', err, { id });
    } finally {
        store.loading.value = false;
    }
}

// managerFinalApproveWo — validate 11 required fields, assign job#, create work_orders,
// set status='in production'. This is the terminal step for a WO request.
export async function managerFinalApproveWo() {
    const req  = store.managerWoSelectedRequest.value;
    const form = store.managerWoDetailForm.value;
    if (!req) return;

    const missing = [];
    if (form.qty_to_make         === '' || form.qty_to_make        == null) missing.push('Qty to Make');
    if (form.estimated_lead_time  === '' || form.estimated_lead_time == null) missing.push('Est. Lead Time');
    if (!form.date_to_start)                                                  missing.push('Date to Start');
    if (!form.weld)                                                           missing.push('Weld');
    if (!form.weld_print)                                                     missing.push('Weld Print');
    if (!form.fab)                                                            missing.push('Fab');
    if (!form.fab_print)                                                      missing.push('Fab Print');
    if (!form.bent_rolled_part)                                               missing.push('Bent / Rolled Part');
    if (form.set_up_time         === '' || form.set_up_time        == null)  missing.push('Set Up Time');
    if (!form.assy_wo)                                                        missing.push('Assy WO');
    if (!form.staging_area)                                                   missing.push('Staging Area');

    if (missing.length > 0) {
        store.showToast('Missing required: ' + missing.join(', '), 'error', 7000);
        return;
    }

    store.loading.value = true;
    try {
        const { data: jobNumber, error: jobErr } = await db.assignJobNumberIfMissing(req.id);
        if (jobErr) throw jobErr;

        const today   = new Date().toISOString().slice(0, 10);
        const updates = { ..._buildUpdates(form), status: 'in production', created_date: today };
        const { error } = await db.updateWoRequest(req.id, updates);
        if (error) throw error;

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

        // Fire-and-forget: learn routing defaults for this part
        const partNum = (req.part_number || '').trim();
        if (partNum) {
            db.learnPartApprovalDefaults(partNum, {
                fab:              updates.fab,
                fab_print:        updates.fab_print,
                weld:             updates.weld,
                weld_print:       updates.weld_print,
                assy_wo:          updates.assy_wo,
                color:            updates.color,
                bent_rolled_part: updates.bent_rolled_part,
            }).catch(err => logError('managerFinalApproveWo:learnDefaults', err, { part: partNum }));
        }

        // Sync est. lead time as a date to the matching open order deadline
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

        // Traveller: create group + subpart work_orders from saved subpart_plans
        const subpartPlans   = req.subpart_plans || {};
        const subpartEntries = Object.entries(subpartPlans)
            .filter(([, f]) => parseFloat(f.qty_to_make) > 0);
        if (subpartEntries.length > 0) {
            const { data: trav, error: tErr } = await db.insertTraveller();
            if (tErr) throw tErr;
            await db.updateWoRequest(req.id, { traveller_id: trav.id });

            const norms = subpartEntries.map(([n]) => n);
            const { data: bd } = await db.fetchBinAndDescForParts(norms);
            const descs = bd?.descs || {};

            const subRows = subpartEntries.map(([n, f]) => ({
                part_number:         n.trim().toUpperCase(),
                description:         descs[n] || '',
                qty_to_make:         parseFloat(f.qty_to_make),
                fab:                 f.fab           || null,
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
                parent_request_id:   req.id,
                status:              'approved',
                submitted_by:        'System',
                request_date:        today,
            }));
            const { data: subData, error: subErr } = await db.batchInsertWoRequests(subRows);
            if (subErr) throw subErr;

            await Promise.all((subData || []).map(async sub => {
                const { data: subJobNum, error: sjErr } = await db.assignJobNumberIfMissing(sub.id);
                if (sjErr) { logError('managerFinalApproveWo:subJobNum', sjErr, { id: sub.id }); return; }
                const { error: swErr } = await db.insertWorkOrdersFromRequest({ ...sub, job_number: subJobNum });
                if (swErr) logError('managerFinalApproveWo:subWorkOrders', swErr, { id: sub.id });
            }));
        }

        store.showToast('Approved — Job #' + jobNumber + ' sent to production.', 'success');
        closeManagerWoDetail();
        await loadManagerPendingWoRequests();
    } catch (err) {
        store.showToast('Failed to approve: ' + err.message, 'error');
        logError('managerFinalApproveWo', err, { id: req.id });
    } finally {
        store.loading.value = false;
    }
}

// openManagerWoSendBack — open the send-back note panel.
export function openManagerWoSendBack() {
    store.managerWoSendBackNote.value = '';
    store.managerWoSendBackOpen.value = true;
}

// cancelManagerWoSendBack — close the panel without saving.
export function cancelManagerWoSendBack() {
    store.managerWoSendBackOpen.value = false;
    store.managerWoSendBackNote.value = '';
}

// submitManagerWoSendBack — set status='pending' with a note, return to planner queue.
export async function submitManagerWoSendBack() {
    const req  = store.managerWoSelectedRequest.value;
    const note = store.managerWoSendBackNote.value?.trim();
    if (!req)  return;
    if (!note) { store.showToast('Enter a note before sending back.', 'error'); return; }

    store.loading.value = true;
    try {
        const { error } = await db.updateWoRequest(req.id, {
            status:           'pending',
            production_notes: note,
        });
        if (error) throw error;
        store.showToast('Sent back to planner queue.', 'success');
        closeManagerWoDetail();
        await loadManagerPendingWoRequests();
    } catch (err) {
        store.showToast('Failed to send back: ' + err.message, 'error');
        logError('submitManagerWoSendBack', err, { id: req.id });
    } finally {
        store.loading.value = false;
    }
}
