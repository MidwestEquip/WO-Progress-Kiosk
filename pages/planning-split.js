// ============================================================
// pages/planning-split.js — split an approved planning line into timed
// batches (sibling planning_run_lines rows). Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

function _today() { return new Date().toISOString().slice(0, 10); }

// _groupLines — all currently-loaded rows of a split group, deduped across the
// run grid, the send panel, AND the scheduling view (a line may be split from
// any of the three surfaces).
function _groupLines(splitGroup) {
    const map = new Map();
    [...store.runLines.value, ...store.releaseDueLines.value, ...store.scheduledLines.value]
        .forEach(l => { if (l.split_group && l.split_group === splitGroup) map.set(l.id, l); });
    return [...map.values()];
}

// _applySplitToArrays — reflect a split in place: drop the old group's other
// rows, update the survivor, add the new siblings — in both the run grid and
// the send panel. Siblings are only added to an array that already holds the
// survivor (so another run's grid is left untouched).
function _applySplitToArrays(oldGroup, survivor, siblings) {
    const apply = arr => {
        const hasSurvivor = arr.some(l => l.id === survivor.id);
        let next = arr.filter(l => !(oldGroup && l.split_group === oldGroup && l.id !== survivor.id));
        next = next.map(l => (l.id === survivor.id ? { ...l, ...survivor, checked: false } : l));
        if (hasSurvivor) {
            const have = new Set(next.map(l => l.id));
            siblings.forEach(s => { if (!have.has(s.id)) next.push({ ...s, checked: false }); });
        }
        return next;
    };
    store.runLines.value = apply(store.runLines.value);
    store.releaseDueLines.value = apply(store.releaseDueLines.value);
    store.scheduledLines.value = apply(store.scheduledLines.value);
}

// openPlanSplit — open the split modal prefilled from a line. Only approved
// (not-yet-released) lines can be split. For a line already in a split group,
// this is a RE-SPLIT: the whole group's remaining qty is re-planned (blocked
// once any batch in the group has been released). Total defaults to the qty;
// first release to the (earliest) date.
export function openPlanSplit(line) {
    if (!line || !['approved', 'scheduled'].includes(line.line_status)) {
        store.showToast('Only approved or scheduled (not yet released) lines can be split.');
        return;
    }
    let total = Number(line.override_qty ?? line.recommended) || 0;
    let startDate = line.planned_release_date || _today();
    if (line.split_group) {
        const group = _groupLines(line.split_group);
        if (group.some(l => l.line_status === 'released')) {
            store.showToast('Some batches already released — this group can no longer be re-split.');
            return;
        }
        total = group.reduce((s, l) => s + (Number(l.override_qty ?? l.recommended) || 0), 0);
        const dates = group.map(l => l.planned_release_date).filter(Boolean).sort();
        startDate = dates[0] || startDate;
    }
    store.planSplitLine.value = line;
    store.planSplitForm.value = { total, count: 2, intervalValue: 2, intervalUnit: 'months', startDate };
    store.planSplitOpen.value = true;
}

// closePlanSplit — dismiss without writing.
export function closePlanSplit() {
    store.planSplitOpen.value = false;
    store.planSplitLine.value = null;
}

// submitPlanSplit — validate the preview, write the batch group, reload the
// grid. Needs at least 2 batches (a 1-batch "split" is a no-op).
export async function submitPlanSplit() {
    const line = store.planSplitLine.value;
    const batches = store.planSplitPreview.value;
    if (!line) return;
    if (batches.length < 2) {
        store.showToast('Enter a total and at least 2 batches to split.');
        return;
    }
    const oldGroup = line.split_group || null;
    store.planSplitSaving.value = true;
    try {
        // Re-split: drop the old group's OTHER batches first (survivor = `line`,
        // which splitRunLine re-stamps into batch 1 of the new group). Delete
        // first so a mid-failure leaves the survivor intact, never duplicates.
        if (oldGroup) {
            const otherIds = _groupLines(oldGroup).filter(l => l.id !== line.id).map(l => l.id);
            if (otherIds.length) {
                const { error: dErr } = await db.deleteRunLines(otherIds);
                if (dErr) throw dErr;
            }
        }
        const group = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID() : String(Date.now());
        const { data, error } = await db.splitRunLine(line, batches, group, store.sessionRole.value || null);
        if (error) throw error;
        // splitRunLine returns raw rows (no joined family_name) — carry it over
        // from the source line so the panel label stays populated.
        (data.siblings || []).forEach(s => { s.family_name = line.family_name || ''; });
        // Reflect the new group in both surfaces without a full reload.
        _applySplitToArrays(oldGroup, data.survivor, data.siblings);
        store.showToast(`Split into ${batches.length} batches.`, 'success');
        closePlanSplit();
    } catch (err) {
        store.showToast('Split failed: ' + err.message);
        logError('submitPlanSplit', err, { id: line.id });
    } finally {
        store.planSplitSaving.value = false;
    }
}
