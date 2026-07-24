// ============================================================
// libs/db-planning-gantt.js — the schedule Gantt's one loader.
// Reads only: everything the timeline draws is derived in
// buildGanttBars (utils-planning-schedule.js). Re-exported by db.js.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { fetchWorkCenters, fetchRoutingsForParts, fetchRoutingDefaultsForParts }
    from './db-planning-runs.js';

// Line states the Gantt draws: committed work with a date on it. 'proposed' is
// still being decided and 'skipped' never happens, so neither belongs on a
// shop timeline.
const GANTT_LINE_STATUSES = ['approved', 'scheduled', 'released'];

// fetchGanttLines — committed MAKE lines carrying a release date, for one run
// or (runId 'all'/null) every run. Buy lines are excluded: a PO consumes no
// shop capacity, so it has no bar. Output: { data: rows, error }.
export async function fetchGanttLines(runId) {
    let q = supabase.from('planning_run_lines')
        .select('id, run_id, part_number, part_number_normalized, recommended, ' +
                'override_qty, action, line_status, planned_release_date, required_date, ' +
                'split_seq, split_total')
        .in('line_status', GANTT_LINE_STATUSES)
        .not('planned_release_date', 'is', null)
        .eq('action', 'make')
        .order('planned_release_date', { ascending: true })
        .limit(2000);
    if (runId && runId !== 'all') q = q.eq('run_id', runId);
    const { data, error } = await withRetry(() => q);
    return { data: data || [], error };
}

// fetchDeptEstimatesForParts — per-part, per-dept day overrides, batched.
// Output: { data: { NORM: { Fab: days, Weld: days, … } }, error }.
export async function fetchDeptEstimatesForParts(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('part_dept_estimates')
                .select('part_number_normalized, dept, est_days')
                .in('part_number_normalized', norms.slice(i, i + 100)));
        if (error) return { data: map, error };
        (data || []).forEach(r => {
            (map[r.part_number_normalized] = map[r.part_number_normalized] || {})[r.dept] = r.est_days;
        });
    }
    return { data: map, error: null };
}

// fetchDeptEstimates — every override, newest first, for the Workload editor.
// Output: { data: rows, error }.
export async function fetchDeptEstimates() {
    const { data, error } = await withRetry(() =>
        supabase.from('part_dept_estimates').select('*')
            .order('part_number_normalized', { ascending: true })
            .order('dept', { ascending: true })
            .limit(1000));
    return { data: data || [], error };
}

// upsertDeptEstimate — save one part+dept override. part_number_normalized is a
// GENERATED column, so the unique index is not usable as a PostgREST conflict
// target — this reads the existing row and updates it, or inserts a new one.
// Input: { part_number, dept, est_days, updated_by }. Output: { data, error }.
export async function upsertDeptEstimate(fields) {
    const part = (fields.part_number || '').trim().toUpperCase();
    const dept = (fields.dept || '').trim();
    const days = Number(fields.est_days);
    if (!part || !dept) return { data: null, error: new Error('Part number and dept are required') };
    if (!Number.isFinite(days) || days < 0) return { data: null, error: new Error('Days must be 0 or more') };

    const { data: found, error: fErr } = await withRetry(() =>
        supabase.from('part_dept_estimates').select('id')
            .eq('part_number_normalized', part).eq('dept', dept).limit(1));
    if (fErr) return { data: null, error: fErr };

    const row = { part_number: part, dept, est_days: days,
                  updated_by: fields.updated_by || null, updated_at: new Date().toISOString() };
    if (found && found[0]) {
        return supabase.from('part_dept_estimates').update(row).eq('id', found[0].id).select().single();
    }
    return supabase.from('part_dept_estimates').insert(row).select().single();
}

// deleteDeptEstimate — drop one override; that part+dept returns to the
// GANTT_DEPT_DEFAULT_DAYS default. Output: { data, error }.
export async function deleteDeptEstimate(id) {
    const { data, error } = await supabase.from('part_dept_estimates')
        .delete().eq('id', id).select().single();
    return { data, error };
}

// fetchWoRoutingFlagsForParts — routing flags off each part's most recent WO
// request. The SECOND source of dept placement, used only for parts that have
// no part_approval_defaults row: without it those parts strand on Unassigned
// even though the shop has built them before.
// Output: { data: { NORM: { fab, weld, assy_wo, color } }, error }.
export async function fetchWoRoutingFlagsForParts(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('wo_requests')
                .select('part_number, fab, weld, assy_wo, color, created_at')
                .in('part_number', norms.slice(i, i + 100))
                .order('created_at', { ascending: false })
                .limit(1000));
        if (error) return { data: map, error };
        // Newest first, so the first sighting of a part wins.
        (data || []).forEach(r => {
            const k = normalizePartNumber(r.part_number);
            if (k && !map[k]) map[k] = { fab: r.fab, weld: r.weld, assy_wo: r.assy_wo, color: r.color };
        });
    }
    return { data: map, error: null };
}

// fetchGanttData — one call for everything the timeline needs: the lines, the
// work centers (Y axis), the real part_routings, and the learned dept flags
// used as the fallback routing for parts that have none.
// A routing/defaults failure is NON-fatal — the timeline still draws, those
// parts just land on fallback rows — so only a lines/work-center error is
// returned as `error`.
// Input:  runId — a planning_runs.id, or 'all'/null for every run.
// Output: { data: { lines, workCenters, routings, deptFlags }, error }.
export async function fetchGanttData(runId) {
    const empty = { lines: [], workCenters: [], routings: {}, deptFlags: {}, deptEstimates: {} };
    const [{ data: lines, error: lErr }, { data: wcs, error: wErr }] = await Promise.all([
        fetchGanttLines(runId),
        fetchWorkCenters(),
    ]);
    if (lErr) return { data: empty, error: lErr };
    if (wErr) return { data: { ...empty, lines }, error: wErr };

    const parts = [...new Set(lines.map(l => l.part_number_normalized).filter(Boolean))];
    if (!parts.length) return { data: { ...empty, lines, workCenters: wcs }, error: null };

    const [{ data: routings }, { data: defs }, { data: woFlags }, { data: deptEstimates }] =
        await Promise.all([
            fetchRoutingsForParts(parts),
            fetchRoutingDefaultsForParts(parts),
            fetchWoRoutingFlagsForParts(parts),
            fetchDeptEstimatesForParts(parts),
        ]);

    // Learned defaults win; the last WO's routing fills in the parts they miss.
    const deptFlags = { ...(woFlags || {}), ...(defs || {}) };
    return {
        data: {
            lines, workCenters: wcs,
            routings: routings || {}, deptFlags,
            deptEstimates: deptEstimates || {},
        },
        error: null,
    };
}

// fetchGanttRunSummaries — one row per plan for the Schedule tab's tiles:
// the run header plus its committed-line counts and date span. Counts come
// from the same line set the timeline draws, so a tile can never advertise
// bars the Gantt does not show.
// Output: { data: [{ ...run, lineCount, firstDate, lastDate, partCount }], error }.
export async function fetchGanttRunSummaries() {
    const [{ data: runs, error: rErr }, { data: lines, error: lErr }] = await Promise.all([
        withRetry(() => supabase.from('planning_runs')
            .select('id, family_name, plan_qty, status, plan_basis, required_date, created_at')
            .order('created_at', { ascending: false })
            .limit(100)),
        fetchGanttLines('all'),
    ]);
    if (rErr) return { data: [], error: rErr };
    if (lErr) return { data: [], error: lErr };

    const agg = {};
    (lines || []).forEach(l => {
        const a = agg[l.run_id] = agg[l.run_id] || { lineCount: 0, parts: new Set(), first: null, last: null };
        a.lineCount++;
        if (l.part_number_normalized) a.parts.add(l.part_number_normalized);
        const d = l.planned_release_date;
        if (d && (!a.first || d < a.first)) a.first = d;
        if (d && (!a.last  || d > a.last))  a.last  = d;
    });
    const out = (runs || []).map(r => {
        const a = agg[r.id] || { lineCount: 0, parts: new Set(), first: null, last: null };
        return { ...r, lineCount: a.lineCount, partCount: a.parts.size,
                 firstDate: a.first, lastDate: a.last };
    });
    return { data: out, error: null };
}
