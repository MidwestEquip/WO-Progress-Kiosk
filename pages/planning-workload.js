// ============================================================
// pages/planning-workload.js — Workload tab: work centers,
// part routings (seeded from time-session actuals), weekly
// capacity heatmap data loads. Imports store/db/utils only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { sanitizeText } from '../libs/utils.js';
import { logError } from '../libs/db-shared.js';

// loadWorkload — work centers + approved/released lines + their routings.
// The heatmap itself is the workloadGrid computed in store-planning.js.
export async function loadWorkload() {
    store.workloadLoading.value = true;
    try {
        const [{ data: wcs, error: wcErr }, { data: lines, error: lErr }] = await Promise.all([
            db.fetchWorkCenters(),
            db.fetchApprovedLinesForWorkload(),
        ]);
        if (wcErr) throw wcErr;
        if (lErr) throw lErr;
        store.workCenters.value = wcs;
        store.workloadLines.value = lines;
        const parts = [...new Set(lines.map(l => l.part_number_normalized))];
        const { data: routings, error: rErr } = await db.fetchRoutingsForParts(parts);
        if (rErr) throw rErr;
        store.workloadRoutings.value = routings;
        store.workloadLoadedAt.value = new Date();
        loadDeptEstimates();   // non-blocking: the heatmap does not depend on it
    } catch (err) {
        store.showToast('Failed to load workload: ' + err.message);
        logError('loadWorkload', err);
    } finally {
        store.workloadLoading.value = false;
    }
}

// loadDeptEstimates — the per-part, per-dept day overrides list.
export async function loadDeptEstimates() {
    try {
        const { data, error } = await db.fetchDeptEstimates();
        if (error) throw error;
        store.deptEstimateRows.value = data;
    } catch (err) {
        store.showToast('Failed to load dept estimates: ' + err.message);
        logError('loadDeptEstimates', err);
    }
}

// saveDeptEstimate — save one part+dept override from the inline form.
// 0 days is valid and means "this part skips that dept" on the timeline.
export async function saveDeptEstimate() {
    const f = store.deptEstForm.value;
    const part = sanitizeText(f.part_number || '').toUpperCase();
    const days = Number(f.est_days);
    if (!part)          { store.showToast('Part number is required.'); return; }
    if (!f.dept)        { store.showToast('Pick a department.'); return; }
    if (!Number.isFinite(days) || days < 0) { store.showToast('Days must be 0 or more.'); return; }
    store.deptEstSaving.value = true;
    try {
        const { error } = await db.upsertDeptEstimate({
            part_number: part, dept: f.dept, est_days: days,
            updated_by: store.sessionRole.value || null,
        });
        if (error) throw error;
        store.deptEstForm.value = { part_number: '', dept: '', est_days: null };
        store.showToast(`${part} ${f.dept}: ${days} day(s) saved.`, 'success');
        loadDeptEstimates();
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveDeptEstimate', err, { part });
    } finally {
        store.deptEstSaving.value = false;
    }
}

// removeDeptEstimate — drop one override; that part+dept goes back to the default.
export async function removeDeptEstimate(id) {
    try {
        const { error } = await db.deleteDeptEstimate(id);
        if (error) throw error;
        store.deptEstimateRows.value = store.deptEstimateRows.value.filter(r => r.id !== id);
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('removeDeptEstimate', err, { id });
    }
}

// saveWorkCenter — add/update a work center from the inline form.
export async function saveWorkCenter() {
    const f = store.wcForm.value;
    if (!sanitizeText(f.name || '')) { store.showToast('Work center name is required.'); return; }
    try {
        const { error } = await db.upsertWorkCenter(f);
        if (error) throw error;
        store.wcForm.value = { name: '', dept: '', available_hours_week: 40 };
        store.showToast('Work center saved.', 'success');
        loadWorkload();
    } catch (err) {
        store.showToast('Save failed: ' + err.message);
        logError('saveWorkCenter', err);
    }
}

// removeWorkCenter — delete a work center (its routings cascade).
export async function removeWorkCenter(id) {
    try {
        const { error } = await db.deleteWorkCenter(id);
        if (error) throw error;
        store.showToast('Work center removed.', 'success');
        loadWorkload();
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('removeWorkCenter', err, { id });
    }
}

// suggestRoutingHours — pull average actual hours/part for the routing form's
// part from wo_time_sessions history (the derive-from-actuals seed).
export async function suggestRoutingHours() {
    const part = sanitizeText(store.routingForm.value.part_number || '').toUpperCase();
    if (!part) { store.showToast('Enter a part number first.'); return; }
    try {
        const { data, error } = await db.fetchTimeStatsForPart(part);
        if (error) throw error;
        store.routingSuggestion.value = data;
        if (data?.hours_per_part != null) {
            store.routingForm.value.run_hours_per_part = data.hours_per_part;
            store.routingForm.value.source = 'time_sessions';
        } else {
            store.showToast('No time-session history for that part — enter hours manually.');
        }
    } catch (err) {
        store.showToast('Time lookup failed: ' + err.message);
        logError('suggestRoutingHours', err, { part });
    }
}

// saveRouting — add/update one routing row from the inline form.
export async function saveRouting() {
    const f = store.routingForm.value;
    try {
        const { error } = await db.upsertPartRouting(f);
        if (error) throw error;
        store.routingForm.value = { part_number: '', work_center_id: '', seq: 1, setup_hours: 0, run_hours_per_part: 0 };
        store.routingSuggestion.value = null;
        store.showToast('Routing saved.', 'success');
        loadWorkload();
    } catch (err) {
        store.showToast('Routing save failed: ' + err.message);
        logError('saveRouting', err);
    }
}

// removeRouting — delete one routing row.
export async function removeRouting(id) {
    try {
        const { error } = await db.deletePartRouting(id);
        if (error) throw error;
        loadWorkload();
    } catch (err) {
        store.showToast('Delete failed: ' + err.message);
        logError('removeRouting', err, { id });
    }
}

// workloadCellState — heatmap cell color state for one work center + week.
// Pure display helper: over / near / ok / idle.
export function workloadCellState(wc, weekHours) {
    const avail = Number(wc.available_hours_week) || 40;
    if (weekHours > avail) return 'over';
    if (weekHours > avail * 0.85) return 'near';
    if (weekHours > avail * 0.25) return 'ok';
    return 'idle';
}
