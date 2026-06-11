// ============================================================
// pages/wo-request-view.js — WO Request list + form logic
//
// Handles: loading the request list, the New Request form, inline
//          field saves, detail-form save/send-to-manager, forecast,
//          and delete. Detail-modal open/populate lives in
//          wo-request-detail.js (split for the 500-line cap).
// Imports from store + db only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// checkWoRequestPartMatch — on blur of Part # field:
//   1. Queries open_orders for a SO# hint.
//   2. Auto-fills description from issues_receipts if the field is currently blank.
export async function checkWoRequestPartMatch() {
    const part = (store.woRequestForm.value.part_number || '').trim().toUpperCase();
    if (!part) { store.woRequestSoHint.value = null; return; }

    const [{ data: ooData }, { data: desc }] = await Promise.all([
        db.findOpenOrdersByPartNumber(part),
        db.fetchPartDescription(part),
    ]);

    const match = (ooData || []).find(o => o.sales_order);
    store.woRequestSoHint.value = match
        ? { salesOrder: match.sales_order, qty: match.to_ship, partNumber: match.part_number }
        : null;

    if (desc && !store.woRequestForm.value.description) {
        store.woRequestForm.value = { ...store.woRequestForm.value, description: desc };
    }
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
                // status_notes always mirrors the DB value (no preserve-prev): it is also
                // editable in the detail modal, so a reload must reflect the latest saved note.
                status_notes:       r.status_notes ?? '',
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
        submitted_by: '', is_assembly: false
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

// saveWoRequestInlineFields — silently save the inline card fields for a request row.
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
        status_notes:       (s.status_notes || '').trim().slice(0, 300) || null,
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
        status_notes:        (form.status_notes || '').trim().slice(0, 300) || null,
        on_hold:             !!form.on_hold,
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

// toggleWoRequestOnHold — flip the on-hold flag and persist immediately (saving the
// current status note as the reason). No manual Save click needed. Updates the open
// record and its list row in place so the badges/inline note refresh.
export async function toggleWoRequestOnHold() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;
    form.on_hold = !form.on_hold;
    const updates = {
        on_hold:      !!form.on_hold,
        status_notes: (form.status_notes || '').trim().slice(0, 300) || null,
    };
    try {
        const { error } = await db.updateWoRequest(id, updates);
        if (error) throw error;
        store.selectedWoRequest.value = { ...store.selectedWoRequest.value, ...updates };
        const idx = store.woRequests.value.findIndex(r => r.id === id);
        if (idx !== -1) store.woRequests.value[idx] = { ...store.woRequests.value[idx], ...updates };
        if (store.woRequestInlineState.value[id]) {
            store.woRequestInlineState.value[id].status_notes = updates.status_notes ?? '';
        }
        store.showToast(form.on_hold ? 'Put on hold.' : 'Hold removed.', 'success');
    } catch (err) {
        form.on_hold = !form.on_hold; // revert optimistic flip on failure
        store.showToast('Failed to update hold: ' + err.message, 'error');
        logError('toggleWoRequestOnHold', err, { id });
    }
}

// saveWoRequestStatusNote — persist the detail-modal status note on blur (no Save click).
// Updates the open record, list row, and inline state in place so the row note matches.
export async function saveWoRequestStatusNote() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;
    const note = (form.status_notes || '').trim().slice(0, 300) || null;
    try {
        const { error } = await db.updateWoRequest(id, { status_notes: note });
        if (error) throw error;
        store.selectedWoRequest.value = { ...store.selectedWoRequest.value, status_notes: note };
        const idx = store.woRequests.value.findIndex(r => r.id === id);
        if (idx !== -1) store.woRequests.value[idx] = { ...store.woRequests.value[idx], status_notes: note };
        if (store.woRequestInlineState.value[id]) {
            store.woRequestInlineState.value[id].status_notes = note ?? '';
        }
    } catch (err) {
        store.showToast('Failed to save note: ' + err.message, 'error');
        logError('saveWoRequestStatusNote', err, { id });
    }
}

// sendToManagerApproval — validate all 11 required routing fields, save the detail form,
// then set status='manager_review'. Does NOT assign a job number or create work_orders —
// that happens when the manager gives final approval in the Manager Hub.
// Required: qty_to_make, estimated_lead_time, date_to_start, weld, weld_print,
//           fab, fab_print, bent_rolled_part, set_up_time, assy_wo, staging_area.
export async function sendToManagerApproval() {
    const id   = store.selectedWoRequest.value?.id;
    const form = store.woRequestDetailForm.value;
    if (!id) return;

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
        const plans = {};
        Object.entries(store.woRequestSubpartForms.value).forEach(([n, { expanded, defaultsLoaded, ...d }]) => { plans[n] = d; });
        const updates = {
            ..._buildDetailUpdates(form),
            status: 'manager_review',
            subpart_plans: Object.keys(plans).length ? plans : null,
        };
        const { error } = await db.updateWoRequest(id, updates);
        if (error) throw error;
        store.showToast('Sent to manager for final approval.', 'success');
        store.selectedWoRequest.value = null;
        store.woRequestReadOnly.value = false;
        await loadWoRequests();
    } catch (err) {
        store.showToast('Failed to send for approval: ' + err.message, 'error');
        logError('sendToManagerApproval', err, { id });
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
