// ============================================================
// pages/engineering-followup.js — Engineering Follow-Up feature logic
//
// All follow-up case CRUD, modal open/close, history.
// Imports from store + db + utils only. Never imported by other page files.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { addCalendarDays, addBusinessDays } from '../libs/utils.js';

// enterEngineeringFollowupView — navigate to Engineering > Customer Follow Up and load cases.
export async function enterEngineeringFollowupView() {
    store.engView.value     = 'followup';
    store.currentView.value = 'engineering';
    await loadEngFollowups();
}

// loadEngFollowups — fetch active follow-up cases into store.
export async function loadEngFollowups() {
    store.engFollowupsLoading.value = true;
    const { data, error } = await db.fetchEngineeringFollowups();
    store.engFollowupsLoading.value = false;
    if (error) { store.showToast('Could not load follow-ups: ' + error.message); return; }
    store.engFollowups.value = data;
}

// openEngFollowupCreate — reset and open the create form.
export function openEngFollowupCreate() {
    store.engFollowupForm.value = {
        part_number: '', description: '', sales_order: '', wo_number: '',
        customer_name: '', customer_email: '', customer_phone: '',
        change_description: '', date_changed_created: '', date_shipped: '',
        priority: 'normal', next_action_owner: '', follow_up_notes: '',
    };
    store.engFollowupFormErrors.value = {};
    store.engFollowupModalMode.value  = 'create';
    store.engFollowupModalOpen.value  = true;
}

// openEngFollowupDetail — open detail modal for a case and load its event history.
export async function openEngFollowupDetail(row) {
    store.engFollowupSelected.value   = { ...row };
    store.engFollowupModalMode.value  = 'detail';
    store.engFollowupActiveTab.value  = 'part';
    store.engFollowupEvents.value     = [];
    store.engFollowupNewNote.value    = '';
    store.engFollowupNewNoteBy.value  = '';
    store.engFollowupModalOpen.value  = true;
    await loadEngFollowupEvents(row.id);
}

// closeEngFollowupModal — close and clear.
export function closeEngFollowupModal() {
    store.engFollowupModalOpen.value = false;
    store.engFollowupSelected.value  = null;
    store.engFollowupEvents.value    = [];
}

// loadEngFollowupEvents — fetch history rows for the selected case.
export async function loadEngFollowupEvents(followupId) {
    store.engFollowupEventsLoading.value = true;
    const { data, error } = await db.fetchEngineeringFollowupEvents(followupId);
    store.engFollowupEventsLoading.value = false;
    if (error) { store.showToast('Could not load history: ' + error.message); return; }
    store.engFollowupEvents.value = data;
}

// submitEngFollowupCreate — validate, apply auto-status rules, insert, add creation event, reload.
export async function submitEngFollowupCreate() {
    const form = store.engFollowupForm.value;
    const errors = {};
    if (!form.part_number?.trim()) errors.part_number = true;
    if (Object.keys(errors).length) { store.engFollowupFormErrors.value = errors; return; }
    let status = 'waiting_to_ship';
    let next_action = 'Enter shipped date / confirm product shipped';
    let next_action_due_date = null;
    if (form.date_shipped) {
        status = 'waiting_for_customer_use';
        next_action = 'Follow up with customer';
        next_action_due_date = addCalendarDays(form.date_shipped, 21);
    }
    store.loading.value = true;
    const { data: newRow, error } = await db.createEngineeringFollowup({
        part_number:          form.part_number.trim().toUpperCase(),
        description:          form.description?.trim()          || null,
        sales_order:          form.sales_order?.trim()          || null,
        wo_number:            form.wo_number?.trim()            || null,
        customer_name:        form.customer_name?.trim()        || null,
        customer_email:       form.customer_email?.trim()       || null,
        customer_phone:       form.customer_phone?.trim()       || null,
        change_description:   form.change_description?.trim()   || null,
        date_changed_created: form.date_changed_created         || null,
        date_shipped:         form.date_shipped                 || null,
        priority:             form.priority                     || 'normal',
        next_action_owner:    form.next_action_owner?.trim()    || null,
        follow_up_notes:      form.follow_up_notes?.trim()      || null,
        status, next_action, next_action_due_date,
    });
    if (error) {
        store.loading.value = false;
        store.showToast('Could not save: ' + error.message);
        return;
    }
    await db.insertEngineeringFollowupEvent({
        followup_id: newRow.id, event_type: 'created', note: 'Case created.',
        new_status: status, next_action, next_action_due_date,
        created_by: form.next_action_owner?.trim() || null,
    });
    store.loading.value = false;
    store.showToast('Follow-up case created.', 'success');
    store.engFollowupModalOpen.value = false;
    await loadEngFollowups();
}

// saveEngFollowupDetail — write all fields on the selected case to the DB.
export async function saveEngFollowupDetail() {
    const row = store.engFollowupSelected.value;
    if (!row?.id) return;
    store.loading.value = true;
    const t = (s) => s?.trim() || null;
    const { error } = await db.updateEngineeringFollowup(row.id, {
        part_number:           (row.part_number || '').trim().toUpperCase() || null,
        description:           t(row.description),
        sales_order:           t(row.sales_order),
        wo_number:             t(row.wo_number),
        customer_name:         t(row.customer_name),
        customer_email:        t(row.customer_email),
        customer_phone:        t(row.customer_phone),
        customer_info_raw:     t(row.customer_info_raw),
        change_description:    t(row.change_description),
        date_changed_created:  row.date_changed_created  || null,
        date_shipped:          row.date_shipped           || null,
        priority:              row.priority               || 'normal',
        status:                row.status                 || null,
        next_action:           t(row.next_action),
        next_action_due_date:  row.next_action_due_date   || null,
        next_action_owner:     t(row.next_action_owner),
        follow_up_questions:   t(row.follow_up_questions),
        follow_up_notes:       t(row.follow_up_notes),
        second_follow_up_date: row.second_follow_up_date  || null,
        fit_status:            row.fit_status             || 'pending',
        customer_response:     t(row.customer_response),
        fit_notes:             t(row.fit_notes),
        fits_chute:            t(row.fits_chute),
        fits_bracket:          t(row.fits_bracket),
        fits_adaptor:          t(row.fits_adaptor),
        fits_pin:              t(row.fits_pin),
        fits_model:            t(row.fits_model),
        new_chute_number:      t(row.new_chute_number),
        dims:                  t(row.dims),
        alere_bom_updated:      row.alere_bom_updated      ?? false,
        alere_part_updated:     row.alere_part_updated     ?? false,
        print_updated:          row.print_updated          ?? false,
        dxf_updated:            row.dxf_updated            ?? false,
        autodesk_files_updated: row.autodesk_files_updated ?? false,
        cad_3d_updated:         row.cad_3d_updated         ?? false,
        assembly_model_updated: row.assembly_model_updated ?? false,
        manual_updated:         row.manual_updated         ?? false,
        fit_mapping_recorded:   row.fit_mapping_recorded   ?? false,
        finalized_notes:        t(row.finalized_notes),
        updated_by:             t(row.updated_by),
    });
    store.loading.value = false;
    if (error) { store.showToast('Could not save: ' + error.message); return; }
    store.showToast('Saved.', 'success');
    await loadEngFollowups();
}

// submitEngFollowupNote — append a manual note to the case history.
export async function submitEngFollowupNote() {
    const row  = store.engFollowupSelected.value;
    const note = store.engFollowupNewNote.value.trim();
    if (!row?.id || !note) return;
    store.loading.value = true;
    const { error } = await db.insertEngineeringFollowupEvent({
        followup_id: row.id,
        event_type:  'note',
        note,
        created_by:  store.engFollowupNewNoteBy.value.trim() || null,
    });
    store.loading.value = false;
    if (error) { store.showToast('Could not save note: ' + error.message); return; }
    store.engFollowupNewNote.value   = '';
    store.engFollowupNewNoteBy.value = '';
    await loadEngFollowupEvents(row.id);
}

// _applyFollowupPatch — private: partial DB update + event insert + list/history refresh.
async function _applyFollowupPatch(row, patch, eventType, note) {
    store.loading.value = true;
    const { error } = await db.updateEngineeringFollowup(row.id, patch);
    if (error) {
        store.loading.value = false;
        store.showToast('Could not update: ' + error.message);
        return false;
    }
    await db.insertEngineeringFollowupEvent({
        followup_id:          row.id,
        event_type:           eventType,
        note,
        new_status:           patch.status               ?? null,
        next_action:          patch.next_action           ?? null,
        next_action_due_date: patch.next_action_due_date  ?? null,
    });
    Object.assign(store.engFollowupSelected.value, patch);
    store.loading.value = false;
    store.showToast('Updated.', 'success');
    await loadEngFollowups();
    await loadEngFollowupEvents(row.id);
    return true;
}

// applyFollowupNoAnswer — no-answer log; status → waiting_on_customer, due = today + 3 business days.
export async function applyFollowupNoAnswer() {
    const row = store.engFollowupSelected.value;
    if (!row?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    await _applyFollowupPatch(row, {
        status:               'waiting_on_customer',
        next_action:          'Follow up — no answer',
        next_action_due_date: addBusinessDays(today, 3),
    }, 'no_answer', 'No answer — follow up scheduled.');
}

// applyFollowupFitConfirmed — fit confirmed; status → finalization_needed, due = today + 2 business days.
export async function applyFollowupFitConfirmed() {
    const row = store.engFollowupSelected.value;
    if (!row?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    await _applyFollowupPatch(row, {
        status:               'finalization_needed',
        fit_status:           'confirmed',
        next_action:          'Complete finalization checklist',
        next_action_due_date: addBusinessDays(today, 2),
    }, 'fit_confirmed', 'Fit confirmed — finalization needed.');
}

// applyFollowupFitFailed — fit failed; status → needs_engineering_review, due = today + 1 business day.
export async function applyFollowupFitFailed() {
    const row = store.engFollowupSelected.value;
    if (!row?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    await _applyFollowupPatch(row, {
        status:               'needs_engineering_review',
        fit_status:           'failed',
        next_action:          'Engineering review required',
        next_action_due_date: addBusinessDays(today, 1),
    }, 'fit_failed', 'Fit failed — engineering review needed.');
}

// submitFollowupCustomerResponded — log response note, advance status, close action panel.
export async function submitFollowupCustomerResponded() {
    const row  = store.engFollowupSelected.value;
    const note = store.engFollowupResponseNote.value.trim();
    if (!row?.id || !note) return;
    const newStatus = store.engFollowupResponseType.value;
    const today = new Date().toISOString().slice(0, 10);
    const ok = await _applyFollowupPatch(row, {
        status:               newStatus,
        customer_response:    note,
        next_action:          'Review customer response',
        next_action_due_date: addBusinessDays(today, 2),
    }, 'customer_responded', 'Customer responded: ' + note);
    if (ok) {
        store.engFollowupActionPanel.value  = '';
        store.engFollowupResponseNote.value = '';
        store.engFollowupResponseType.value = 'needs_engineering_review';
    }
}

// closeEngFollowupCase — validate fit determination made, then set status=closed and close the modal.
export async function closeEngFollowupCase() {
    const row = store.engFollowupSelected.value;
    if (!row?.id) return;
    if (!row.fit_status || row.fit_status === 'pending') {
        store.showToast('Set a Fit Status (Fit tab) before closing.');
        return;
    }
    const ok = await _applyFollowupPatch(row,
        { status: 'closed' }, 'closed', 'Case closed.');
    if (ok) closeEngFollowupModal();
}

// onFollowupDateShippedChange — auto-advance to waiting_for_customer_use when date_shipped set from waiting_to_ship.
export async function onFollowupDateShippedChange() {
    const row = store.engFollowupSelected.value;
    if (!row?.id) return;
    if (row.date_shipped && row.status === 'waiting_to_ship') {
        await _applyFollowupPatch(row, {
            date_shipped:         row.date_shipped,
            status:               'waiting_for_customer_use',
            next_action:          'Follow up with customer',
            next_action_due_date: addCalendarDays(row.date_shipped, 21),
        }, 'shipped', 'Product marked as shipped. Follow-up scheduled.');
    } else {
        await saveEngFollowupDetail();
    }
}
