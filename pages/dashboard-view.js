// ============================================================
// pages/dashboard-view.js — Common dashboard logic + Fab/Weld
//
// Handles: open action panel, file attachments, updateStatus,
//          undo, manual WO creation, notes, WO problems,
//          Fab/Weld operator helpers.
//
// TV Assy logic → pages/dashboard-tv.js
// TC Assy logic → pages/dashboard-tc.js
// ============================================================

import * as store  from '../libs/store.js';
import * as db     from '../libs/db.js';
import { deepClone, sanitizeText, isNonEmpty, isValidQty } from '../libs/utils.js';
import { fetchDeptOrders } from '../libs/db.js';

// ── openActionPanel ───────────────────────────────────────────
export function openActionPanel(order) {
    store.activeOrder.value      = order;
    store.actionPanelOpen.value  = true;
    store.selectedOperator.value = order.operator || '';
    store.otherOperator.value    = '';
    store.selectedOperators.value = [];
    store.actionForm.value       = {
        qtyCompleted: (order.department === 'Fab' || order.department === 'Weld') ? 0 : (order.qty_completed || 0),
        qtyScrap:     0,
        scrapReason:  '',
        notes:        '',
        holdReason:   '',
        weldGrind:    ''
    };
    loadWoFiles(order.part_number);
}

// ── Part print attachment handlers ────────────────────────────
// Files are stored by Part # so uploads are shared across all WOs for the same part.

// Load the file list for a part number into store.woFiles
export async function loadWoFiles(partNumber) {
    if (!partNumber) { store.woFiles.value = []; return; }
    store.woFilesLoading.value = true;
    const { data, error } = await db.listWoFiles(partNumber);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Could not load files: ' + error.message); return; }
    store.woFiles.value = data || [];
}

// Handle file picker change event — upload selected file then refresh list
export async function handleWoFileUpload(event) {
    const file = event.target.files[0];
    if (!file || !store.activeOrder.value?.part_number) return;
    event.target.value = '';   // reset so the same file can be re-uploaded
    store.woFilesLoading.value = true;
    const { error } = await db.uploadWoFile(store.activeOrder.value.part_number, file);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Upload failed: ' + error.message); return; }
    store.showToast('File uploaded.', 'success');
    await loadWoFiles(store.activeOrder.value.part_number);
}

// Delete a file from storage then refresh the list
export async function handleWoFileDelete(filename) {
    if (!store.activeOrder.value?.part_number) return;
    store.woFilesLoading.value = true;
    const { error } = await db.deleteWoFile(store.activeOrder.value.part_number, filename);
    store.woFilesLoading.value = false;
    if (error) { store.showToast('Delete failed: ' + error.message); return; }
    await loadWoFiles(store.activeOrder.value.part_number);
}

// ── getFinalOperatorName ──────────────────────────────────────
// Returns the selected operator name (resolves "Other" to free-text field)
export function getFinalOperatorName() {
    return store.selectedOperator.value === 'Other'
        ? store.otherOperator.value.trim()
        : store.selectedOperator.value;
}

// ── updateOrderStatus ─────────────────────────────────────────
// Main action: update a WO's status (and optionally a sub-stage).
// Validates inputs, saves undo snapshot, writes to DB, refreshes list.
export async function updateOrderStatus(newStatus, stageKey = null) {
    const dept = store.activeOrder.value?.department;
    const opName = (dept === 'Fab' || dept === 'Weld')
        ? getFabWeldOperatorName()
        : getFinalOperatorName();
    if (!opName) {
        store.showToast('Select or enter your operator name first.', 'error');
        return;
    }
    if (store.isReel.value && !store.actionForm.value.weldGrind && newStatus === 'started') {
        store.showToast('Select Weld or Grind for this reel part.', 'error');
        return;
    }
    if (newStatus === 'on_hold' && !store.actionForm.value.holdReason.trim()) {
        store.showToast('Select a hold reason first.', 'error');
        return;
    }

    store.loading.value = true;

    // Capture undo snapshot BEFORE writing
    const previousSnapshot = deepClone(store.activeOrder.value);
    const undoDesc = `${opName}: ${newStatus}${stageKey ? ' (' + stageKey + ')' : ''} on WO ${store.activeOrder.value.wo_number}`;

    try {
        const { data, error } = await db.updateOrderStatus({
            id:           store.activeOrder.value.id,
            currentOrder: store.activeOrder.value,
            newStatus,
            stageKey,
            opName,
            actionForm:   store.actionForm.value
        });
        if (error) throw error;

        // Store undo info after confirmed success
        store.lastUndoAction.value = {
            id:           store.activeOrder.value.id,
            previousData: previousSnapshot,
            description:  undoDesc,
            dept:         store.selectedDept.value
        };

        // START / RESUME (Fab/Weld only): stay in modal so operator can
        // immediately log qty and Pause or Complete without reopening.
        if (newStatus === 'started' && !stageKey) {
            // Update activeOrder from DB response so v-if chain flips to PAUSE+COMPLETE view
            store.activeOrder.value = (data && data[0]) ? data[0] : { ...store.activeOrder.value, status: 'started' };
            store.actionForm.value  = { ...store.actionForm.value, qtyCompleted: 0 };
        } else {
            store.actionPanelOpen.value = false;
        }
        await _refreshDeptOrders();
    } catch (err) {
        store.showToast('Failed to update status: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── undoLastAction ────────────────────────────────────────────
// Restores the pre-mutation snapshot of the last changed WO
export async function undoLastAction() {
    if (!store.lastUndoAction.value) return;

    store.loading.value = true;
    try {
        const { id, previousData, dept } = store.lastUndoAction.value;
        const { error } = await db.restoreOrderSnapshot(id, previousData);
        if (error) throw error;

        store.lastUndoAction.value = null;
        store.showToast('Action undone successfully.', 'success');

        // Refresh the current dept view
        if (dept) {
            const { data, err } = await fetchDeptOrders(dept);
            if (!err) store.orders.value = data || [];
        }
    } catch (err) {
        store.showToast('Failed to undo. Please update manually. ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── submitNewWo ───────────────────────────────────────────────
// Creates a new manual work order for TV/TC Assy
export async function submitNewWo() {
    const form = store.newWoForm.value;
    const dept = store.selectedDept.value;

    // ── TC Assy: specific validation + save ───────────────────
    if (dept === 'Tru Cut Assy') {
        const errors = store.newWoFormErrors.value;
        errors.part    = !isNonEmpty(form.part);
        errors.desc    = !isNonEmpty(form.desc);
        errors.qty     = !isValidQty(form.qty) || parseInt(form.qty, 10) < 1;

        if (errors.part || errors.desc || errors.qty) return;

        store.loading.value = true;
        try {
            const { error } = await db.insertManualWorkOrder({
                partNumber:   sanitizeText(form.part),
                description:  sanitizeText(form.desc),
                qty:          parseInt(form.qty, 10),
                dept,
                woType:       store.tcNewWoMode.value === 'unit' ? 'Unit' : 'Subassy',
                tcJobMode:    store.tcNewWoMode.value || 'stock',
                customWoNumber: sanitizeText(form.woNumber),
                unitSerial:   sanitizeText(form.unitSerial),
                engine:       sanitizeText(form.engine),
                engineSerial: sanitizeText(form.engineSerial),
                numBlades:    sanitizeText(form.numBlades)
            });
            if (error) throw error;

            store.newWoModalOpen.value  = false;
            store.newWoFormErrors.value = { part: false, desc: false, qty: false };
            store.newWoForm.value = { part: '', desc: '', qty: 1, type: 'Unit', woNumber: '', salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '' };
            store.tcNewWoModeOverride.value = null;
            await _refreshDeptOrders();
            store.showToast('Work order added to board.', 'success');
        } catch (err) {
            store.showToast('Failed to add work order: ' + err.message);
        } finally {
            store.loading.value = false;
        }
        return;
    }

    // ── Generic / TV Assy ─────────────────────────────────────────
    if (!isNonEmpty(form.part)) {
        store.showToast('Part number is required.', 'error');
        return;
    }

    store.loading.value = true;
    try {
        const { error } = await db.insertManualWorkOrder({
            partNumber:  sanitizeText(form.part),
            description: sanitizeText(form.desc),
            qty:         1,
            dept
        });
        if (error) throw error;

        store.newWoModalOpen.value = false;
        store.newWoForm.value = { part: '', desc: '', qty: 1, type: 'Unit', woNumber: '', salesOrder: '', unitSerial: '', engine: '', engineSerial: '', numBlades: '' };
        await _refreshDeptOrders();
        store.showToast('Work order added to board.', 'success');
    } catch (err) {
        store.showToast('Failed to add work order: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── toggleTcNewWoMode ────────────────────────────────────────
// Flips the user override for the new TC WO form between unit and stock.
export function toggleTcNewWoMode() {
    const current = store.tcNewWoMode.value;
    store.tcNewWoModeOverride.value = current === 'unit' ? 'stock' : 'unit';
}

// ── submitNote ────────────────────────────────────────────────
// Appends a manager note to the active work order
export async function submitNote() {
    store.noteAuthorError.value = !isNonEmpty(store.noteAuthor.value);
    store.noteTextError.value   = !isNonEmpty(store.noteText.value);
    if (store.noteAuthorError.value || store.noteTextError.value) return;

    store.loading.value = true;
    try {
        const { data, error } = await db.appendManagerNote(
            store.activeOrder.value.id,
            store.activeOrder.value.manager_notes || '',
            sanitizeText(store.noteAuthor.value),
            sanitizeText(store.noteText.value)
        );
        if (error) throw error;

        // Update the active order and the card in the orders list immediately
        const updatedNotes = data && data[0] ? data[0].manager_notes : null;
        if (updatedNotes !== null) {
            store.activeOrder.value.manager_notes = updatedNotes;
            const idx = store.orders.value.findIndex(o => o.id === store.activeOrder.value.id);
            if (idx !== -1) store.orders.value[idx].manager_notes = updatedNotes;
        }

        store.noteText.value        = '';
        store.notesPanelOpen.value  = false;
        store.showToast('Note saved.', 'success');
    } catch (err) {
        store.showToast('Failed to save note: ' + err.message);
    } finally {
        store.loading.value = false;
    }
}

// ── submitWoProblemFromUi ─────────────────────────────────────
// Save a WO problem from the action panel inline form.
export async function submitWoProblemFromUi() {
    let valid = true;
    if (!store.woProblemDraftText.value.trim()) {
        store.woProblemDraftError.value = true;
        valid = false;
    }
    if (!store.woProblemDraftName.value.trim()) {
        store.woProblemDraftNameError.value = true;
        valid = false;
    }
    if (!valid) return;

    const order = store.activeOrder.value;
    const name  = store.woProblemDraftName.value.trim();
    const text  = store.woProblemDraftText.value.trim();

    try {
        const { error } = await db.saveWoProblem(order.id, text, name);
        if (error) throw error;
        store.activeOrder.value = {
            ...store.activeOrder.value,
            wo_problem_text:       text,
            wo_problem_status:     'open',
            wo_problem_updated_by: name
        };
        const idx = store.orders.value.findIndex(o => o.id === order.id);
        if (idx !== -1) {
            store.orders.value[idx].wo_problem_text       = text;
            store.orders.value[idx].wo_problem_status     = 'open';
            store.orders.value[idx].wo_problem_updated_by = name;
        }
        store.woProblemDraftText.value      = '';
        store.woProblemDraftError.value     = false;
        store.woProblemDraftName.value      = '';
        store.woProblemDraftNameError.value = false;
        store.showToast('Problem logged.', 'success');
    } catch (err) {
        store.showToast('Failed to save problem: ' + err.message);
    }
}

// ── _refreshDeptOrders ────────────────────────────────────────
// Private: re-fetch the current dept's orders after a status change.
async function _refreshDeptOrders() {
    const dept = store.selectedDept.value;
    if (!dept) return;
    try {
        const { data, error } = await fetchDeptOrders(dept);
        if (error) throw error;
        store.orders.value = data || [];
    } catch (err) {
        store.showToast('Failed to refresh orders: ' + err.message);
    }
}

// ── getFabWeldOperatorName ────────────────────────────────────
// Resolves the Fab/Weld multi-select (with optional "Other" free-text)
// into a single " & "-joined string for storage in work_orders.operator.
export function getFabWeldOperatorName() {
    const base = store.selectedOperators.value.filter(o => o !== 'Other');
    if (store.selectedOperators.value.includes('Other')) {
        const typed = store.otherOperator.value.trim();
        if (typed) {
            typed.split(',').map(s => s.trim()).filter(Boolean).forEach(n => base.push(n));
        }
    }
    return base.join(' & ');
}

// ── holdSince ─────────────────────────────────────────────────
// Parses the last "ON HOLD" log entry from order.notes and returns
// the timestamp string, or null if the WO is not on hold / has no log.
export function holdSince(order) {
    if (!order || order.status !== 'on_hold' || !order.notes) return null;
    const lines = order.notes.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].includes(': ON HOLD')) {
            const m = lines[i].match(/^\[([^\]]+)\]/);
            return m ? m[1] : null;
        }
    }
    return null;
}
