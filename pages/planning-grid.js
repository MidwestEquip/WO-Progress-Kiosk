// ============================================================
// pages/planning-grid.js — Review-grid line interactions: inline qty
// edits, the subpart qty cascade, line saves, select-all, and skip.
// Split from planning-review.js (500-line cap). Imports store/db/utils only;
// no calls into the run-lifecycle or release core.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { computeQtyCascade } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// saveLineQty — a qty edit from the grid. Saves the line, then (if this part
// has subparts in the run and the qty actually moved) offers to push the same
// change down the subtree. The parent is saved either way — cancelling the
// dialog leaves the parent changed and the children alone.
export async function saveLineQty(line, newQty) {
    const from = Number(line.override_qty ?? line.recommended) || 0;
    const to   = Number(newQty);
    if (!Number.isFinite(to) || to < 0) { store.showToast('Enter a quantity of 0 or more.'); return; }
    await saveLineEdit(line, { override_qty: to });
    // The subpart qty cascade is a PLANNING-time action (proposed lines). Editing
    // an approved line or split batch just resizes it — children already netted.
    if (line.line_status !== 'proposed') return;
    if (to === from) return;

    const part = line.part_number_normalized || line.part_number;
    const linesByPart = {};
    store.runLines.value.forEach(l => { linesByPart[l.part_number_normalized || l.part_number] = l; });
    const { changes, skipped } = computeQtyCascade(
        part, to - from, store.runChildIndex.value, linesByPart);
    if (!changes.length && !skipped.length) return;   // no subparts in this run

    store.qtyCascadePreview.value = { part, from, to, delta: to - from, changes, skipped };
    store.qtyCascadeOpen.value = true;
}

// applyQtyCascade — write the previewed child quantities. Each line is saved
// individually (no bulk endpoint); a failure stops the batch and reports how
// far it got, so the grid is never silently half-applied without saying so.
export async function applyQtyCascade() {
    const preview = store.qtyCascadePreview.value;
    if (!preview) return;
    const byPart = {};
    store.runLines.value.forEach(l => { byPart[l.part_number_normalized || l.part_number] = l; });
    store.qtyCascadeSaving.value = true;
    let done = 0;
    try {
        for (const c of preview.changes) {
            const line = byPart[c.part];
            if (!line) continue;
            const { data, error } = await db.updateRunLine(line.id, {
                override_qty: c.to, updated_by: store.sessionRole.value || null,
            });
            if (error) throw error;
            Object.assign(line, data);
            done++;
        }
        store.showToast(`Updated ${done} subpart line(s).`, 'success');
        closeQtyCascade();
    } catch (err) {
        store.showToast(`Cascade stopped after ${done} of ${preview.changes.length}: ${err.message}`);
        logError('applyQtyCascade', err, { part: preview.part, done });
    } finally {
        store.qtyCascadeSaving.value = false;
    }
}

export function closeQtyCascade() {
    store.qtyCascadeOpen.value = false;
    store.qtyCascadePreview.value = null;
}

// saveLineEdit — persist an inline edit (override qty, hold, release date).
export async function saveLineEdit(line, fields) {
    try {
        const { data, error } = await db.updateRunLine(line.id, {
            ...fields, updated_by: store.sessionRole.value || null,
        });
        if (error) throw error;
        Object.assign(line, data);
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveLineEdit', err, { id: line.id });
    }
}

// toggleSelectAllRunLines — check every selectable row in the CURRENT filtered
// view, or clear them all when they are already checked. Rows hidden by the
// filter are left alone. No args, no return.
export function toggleSelectAllRunLines() {
    const next = !store.runLinesAllChecked.value;
    store.selectableRunLines.value.forEach(l => { l.checked = next; });
}

// skipLine — mark one proposed line skipped (not needed).
export async function skipLine(line) {
    await saveLineEdit(line, { line_status: 'skipped' });
}
