// ============================================================
// pages/part-changes-view.js — Engineering > Part Changes
//
// List + create logic for part change records (replacements,
// revisions, 2D→3D conversions, finalizations, BOM changes).
// Detail / checklist logic arrives in the detail patch.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { PART_CHANGE_STATUS_OPEN, PART_CHANGE_STATUS_COMPLETED,
         PART_CHANGE_CHECKLIST_ITEMS } from '../libs/config.js';

// enterPartChangesView — navigate to Engineering > Part Changes and load records.
export async function enterPartChangesView() {
    store.engView.value        = 'part_changes';
    store.currentView.value    = 'engineering';
    store.partChangesTab.value = 'records';
    await loadPartChanges();
}

// loadPartChanges — fetch change records into store (all statuses; filtering is client-side).
export async function loadPartChanges() {
    store.partChangesLoading.value = true;
    const { data, error } = await db.fetchPartChanges();
    store.partChangesLoading.value = false;
    if (error) {
        store.showToast('Could not load part changes: ' + error.message, 'error');
        return;
    }
    store.partChanges.value = data;
}

// openPartChangeCreate — open the New Part Change form with blank fields.
export function openPartChangeCreate() {
    store.partChangeForm.value = {
        change_type: 'replacement', part_number: '', previous_part_number: '',
        replacement_reason: '', carry_forward_note: '',
        use_previous_for_calcs: true, created_by: '',
    };
    store.partChangeFormErrors.value = {};
    store.partChangeFormOpen.value   = true;
}

// closePartChangeCreate — dismiss the New Part Change form without saving.
export function closePartChangeCreate() {
    store.partChangeFormOpen.value = false;
}

// submitPartChangeCreate — validate the form and insert a new open record.
// Replacement records require the previous part number; part numbers are
// trimmed + uppercased before storing.
export async function submitPartChangeCreate() {
    const f = store.partChangeForm.value;
    const errors = {};
    if (!f.change_type)                     errors.change_type = true;
    if (!(f.part_number || '').trim())      errors.part_number = true;
    if (!(f.created_by  || '').trim())      errors.created_by  = true;
    if (f.change_type === 'replacement' && !(f.previous_part_number || '').trim())
        errors.previous_part_number = true;
    store.partChangeFormErrors.value = errors;
    if (Object.keys(errors).length) return;

    const isReplacement = f.change_type === 'replacement';
    const fields = {
        change_type:            f.change_type,
        part_number:            f.part_number.trim().toUpperCase(),
        previous_part_number:   isReplacement ? f.previous_part_number.trim().toUpperCase() : null,
        replacement_reason:     (f.replacement_reason || '').trim() || null,
        carry_forward_note:     (f.carry_forward_note || '').trim() || null,
        use_previous_for_calcs: isReplacement ? !!f.use_previous_for_calcs : false,
        checklist:              {},
        status:                 PART_CHANGE_STATUS_OPEN,
        created_by:             f.created_by.trim(),
    };

    store.partChangeSaving.value = true;
    try {
        const { error } = await db.insertPartChange(fields);
        if (error) throw error;
        store.showToast('Part change record created', 'success');
        store.partChangeFormOpen.value = false;
        await loadPartChanges();
    } catch (err) {
        store.showToast('Could not create part change: ' + err.message, 'error');
    } finally {
        store.partChangeSaving.value = false;
    }
}

// loadWoRequestOpenChanges — open change records for a part, for the WO Request
// detail warning pills. Clears first; guards against a stale response landing
// after a different request was opened. Fails silently (warning is best-effort).
export async function loadWoRequestOpenChanges(partNumber) {
    store.woRequestOpenChanges.value = [];
    if (!partNumber) return;
    const { data, error } = await db.fetchOpenChangesForPart(partNumber);
    if (error) return;
    const openPart = (store.selectedWoRequest.value?.part_number || '').trim().toUpperCase();
    if (openPart !== (partNumber || '').trim().toUpperCase()) return;   // stale
    store.woRequestOpenChanges.value = data;
}

// ── Detail modal + checklist ─────────────────────────────────

// applyUpdatedPartChange — sync an updated row into the detail modal and list.
function applyUpdatedPartChange(row) {
    store.partChangeSelected.value = row;
    const idx = store.partChanges.value.findIndex(r => r.id === row.id);
    if (idx !== -1) store.partChanges.value.splice(idx, 1, row);
}

// openPartChangeDetail — open the detail/checklist modal for a record.
export function openPartChangeDetail(pc) {
    store.partChangeSelected.value   = pc;
    store.partChangeDetailOpen.value = true;
}

// closePartChangeDetail — dismiss the detail modal.
export function closePartChangeDetail() {
    store.partChangeDetailOpen.value = false;
    store.partChangeSelected.value   = null;
}

// setPartChangeChecklistItem — check or N/A one checklist item, stamped with
// name + timestamp. Clicking the same state again clears the item. Open records only.
export async function setPartChangeChecklistItem(itemKey, state) {
    const pc = store.partChangeSelected.value;
    if (!pc || pc.status !== PART_CHANGE_STATUS_OPEN) return;
    const name = store.partChangeCheckName.value.trim();
    if (!name) {
        store.showToast('Enter your name above the checklist first', 'error');
        return;
    }
    const checklist = { ...(pc.checklist || {}) };
    if (checklist[itemKey]?.state === state) delete checklist[itemKey];
    else checklist[itemKey] = { state, by: name, at: new Date().toISOString() };

    const { data, error } = await db.updatePartChange(pc.id, { checklist });
    if (error) {
        store.showToast('Could not save checklist: ' + error.message, 'error');
        return;
    }
    applyUpdatedPartChange(data);
}

// savePartChangeDetail — patch the editable fields (reason, note, calc flag).
export async function savePartChangeDetail() {
    const pc = store.partChangeSelected.value;
    if (!pc) return;
    store.partChangeDetailSaving.value = true;
    const { data, error } = await db.updatePartChange(pc.id, {
        replacement_reason:     (pc.replacement_reason || '').trim() || null,
        carry_forward_note:     (pc.carry_forward_note || '').trim() || null,
        use_previous_for_calcs: !!pc.use_previous_for_calcs,
    });
    store.partChangeDetailSaving.value = false;
    if (error) {
        store.showToast('Could not save: ' + error.message, 'error');
        return;
    }
    applyUpdatedPartChange(data);
    store.showToast('Saved', 'success');
}

// completePartChange — the gate: every checklist item must be checked or N/A
// before the record can be marked completed.
export async function completePartChange() {
    const pc = store.partChangeSelected.value;
    if (!pc || pc.status !== PART_CHANGE_STATUS_OPEN) return;
    const cl = pc.checklist || {};
    const missing = PART_CHANGE_CHECKLIST_ITEMS.filter(i => !cl[i.key]?.state);
    if (missing.length) {
        store.showToast(`Checklist incomplete — ${missing.length} item(s) must be checked or marked N/A`, 'error');
        return;
    }
    store.partChangeDetailSaving.value = true;
    const { data, error } = await db.updatePartChange(pc.id, {
        status: PART_CHANGE_STATUS_COMPLETED, completed_at: new Date().toISOString(),
    });
    store.partChangeDetailSaving.value = false;
    if (error) {
        store.showToast('Could not complete: ' + error.message, 'error');
        return;
    }
    applyUpdatedPartChange(data);
    store.showToast('Part change completed', 'success');
}

// reopenPartChange — undo an accidental completion (status back to open).
export async function reopenPartChange() {
    const pc = store.partChangeSelected.value;
    if (!pc || pc.status !== PART_CHANGE_STATUS_COMPLETED) return;
    const { data, error } = await db.updatePartChange(pc.id, {
        status: PART_CHANGE_STATUS_OPEN, completed_at: null,
    });
    if (error) {
        store.showToast('Could not reopen: ' + error.message, 'error');
        return;
    }
    applyUpdatedPartChange(data);
    store.showToast('Record reopened', 'success');
}
