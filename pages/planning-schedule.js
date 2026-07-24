// ============================================================
// pages/planning-schedule.js — Scheduling view: committed future lines
// (line_status='scheduled') grouped by week. Editing (qty/date) and Split
// reuse the grid/split handlers; Patch 4 auto-releases due ones.
// Imports store/db only.
// ============================================================

import * as store from '../libs/store.js';
import * as db    from '../libs/db.js';
import { logError } from '../libs/db-shared.js';

// loadGanttSummaries — the tile row: every plan with committed dated lines.
// Non-fatal — a summary failure must not take the week list down with it.
export async function loadGanttSummaries() {
    store.ganttSummariesLoading.value = true;
    try {
        const { data, error } = await db.fetchGanttRunSummaries();
        if (error) throw error;
        store.ganttRunSummaries.value = data;
    } catch (err) {
        store.showToast('Failed to load plan tiles: ' + err.message);
        logError('loadGanttSummaries', err);
    } finally {
        store.ganttSummariesLoading.value = false;
    }
}

// openGanttFor — open one plan's timeline (runId) or every plan's ('all').
export async function openGanttFor(runId) {
    store.ganttRunId.value = runId;
    store.schedView.value  = 'gantt';
    store.ganttLoading.value = true;
    try {
        const { data, error } = await db.fetchGanttData(runId);
        if (error) throw error;
        store.ganttSource.value = data;
        if (!data.workCenters.length) {
            store.showToast('No work centers set up yet — add them on the Workload tab.');
        }
    } catch (err) {
        // Leave the previous timeline rather than blanking the screen on a blip.
        store.showToast('Failed to load timeline: ' + err.message);
        logError('openGanttFor', err, { runId });
    } finally {
        store.ganttLoading.value = false;
    }
}

// closeGantt — back to the tile picker.
export function closeGantt() {
    store.schedView.value = 'tiles';
    store.ganttRunId.value = null;
}

// loadScheduled — pull every scheduled line for the scheduling view.
export async function loadScheduled() {
    store.scheduledLoading.value = true;
    try {
        const { data, error } = await db.fetchScheduledLines();
        if (error) throw error;
        store.scheduledLines.value = data.map(l => ({ ...l, checked: false }));
    } catch (err) {
        store.showToast('Failed to load schedule: ' + err.message);
        logError('loadScheduled', err);
    } finally {
        store.scheduledLoading.value = false;
    }
}
