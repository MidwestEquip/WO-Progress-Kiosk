// ============================================================
// libs/db-planning-runs.js — planning runs, release-to-pipeline,
// queue + workload queries. Re-exported by db.js.
// (Split from db-planning.js to respect the 500-line cap.)
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';
import { WO_REQUEST_STATUS_MANAGER_REVIEW } from './config.js';

// insertPlanningRun — save one run header + its lines (chunked bulk insert).
// Rolls the header back if lines fail. Output: { data: { id }, error }.
export async function insertPlanningRun(run, lines) {
    const { data: header, error: hErr } = await supabase
        .from('planning_runs')
        .insert({
            base_unit_id: run.base_unit_id || null,
            family_name: run.family_name,
            plan_qty: Number(run.plan_qty) || 0,
            mode: run.mode === 'base_only' ? 'base_only' : 'full_kit',
            option_splits: run.option_splits || [],
            required_date: run.required_date || null,
            notes: run.notes || null,
            created_by: run.created_by || null,
            // Year-supply sizing. Defaults keep pre-existing callers on the
            // kit basis, which is what they were doing.
            plan_basis: run.plan_basis === 'year_supply' ? 'year_supply' : 'kit',
            pct_adjust: Number(run.pct_adjust) || 0,
            base_sold_12mo: run.base_sold_12mo ?? null,
        })
        .select()
        .single();
    if (hErr) return { data: null, error: hErr };
    const rows = (lines || []).map(l => ({
        run_id: header.id,
        part_number: l.part_number,
        level: l.level,
        gross: l.gross, on_hand_snap: l.on_hand, open_wo_snap: l.open_wo,
        in_flight_snap: l.in_flight, requested_snap: l.requested,
        open_po_snap: l.open_po, min_stock_snap: l.min_stock,
        basis_snap: l.basis_snap ?? null,
        net: l.net, recommended: l.recommended,
        action: l.action, flag: l.flag || null,
        action_source: l.action_source ?? null,
        qty_made_12mo: l.qty_made_12mo ?? null,
        qty_purchased_12mo: l.qty_purchased_12mo ?? null,
        required_date: run.required_date || null,
        // NULL on kit-basis runs — the grid renders those as an em dash, not 0.
        demand_12mo: l.demand_12mo ?? null,
        kit_gross:   l.kit_gross   ?? null,
    }));
    for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('planning_run_lines').insert(rows.slice(i, i + 200));
        if (error) {
            await supabase.from('planning_runs').delete().eq('id', header.id);
            return { data: null, error };
        }
    }
    return { data: { id: header.id }, error: null };
}

// fetchPlanningRuns — run headers, newest first. Output: { data, error }.
export async function fetchPlanningRuns(status = null) {
    let q = supabase.from('planning_runs').select('*')
        .order('created_at', { ascending: false }).limit(100);
    if (status) q = q.eq('status', status);
    const { data, error } = await withRetry(() => q);
    return { data: data || [], error };
}

// fetchRunLines — all lines of one run, level order. Output: { data, error }.
export async function fetchRunLines(runId) {
    const { data, error } = await withRetry(() =>
        supabase.from('planning_run_lines').select('*')
            .eq('run_id', runId)
            .order('level', { ascending: true })
            .order('part_number_normalized', { ascending: true })
            .limit(2000)
    );
    return { data: data || [], error };
}

// updateRunLine — patch decision fields on one line. Output: { data, error }.
export async function updateRunLine(id, fields) {
    const patch = { updated_at: new Date().toISOString() };
    ['override_qty', 'hold', 'line_status', 'planned_release_date', 'required_date',
     'created_ref_type', 'created_ref_id', 'updated_by']
        .forEach(k => { if (fields[k] !== undefined) patch[k] = fields[k]; });
    const { data, error } = await supabase
        .from('planning_run_lines').update(patch).eq('id', id).select().single();
    return { data, error };
}

// deleteRunLines — hard-delete planning_run_lines rows by id (chunked so a
// large selection stays within URL limits). Only safe for lines with no
// created work order / PO — the release-due panel (approved, unreleased) fits.
// Input: array of ids. Output: { error } (null on success or empty input).
export async function deleteRunLines(ids) {
    const list = [...new Set((ids || []).filter(id => id != null))];
    if (!list.length) return { error: null };
    for (let i = 0; i < list.length; i += 200) {
        const { error } = await withRetry(() =>
            supabase.from('planning_run_lines').delete().in('id', list.slice(i, i + 200)));
        if (error) return { error };
    }
    return { error: null };
}

// deletePlanningRun — hard-delete a whole run: its lines first, then the
// header. Used when a run is cancelled/closed (abandoned). A run is only kept
// once fully executed. Output: { error } (null on success).
export async function deletePlanningRun(runId) {
    if (!runId) return { error: null };
    const del = await withRetry(() =>
        supabase.from('planning_run_lines').delete().eq('run_id', runId));
    if (del.error) return { error: del.error };
    const { error } = await withRetry(() =>
        supabase.from('planning_runs').delete().eq('id', runId));
    return { error };
}

// countRunPendingLines — how many of a run's lines still have work to do:
// proposed, approved, or scheduled (committed but not yet released). A run is
// only "executed" once none of these remain. Head count. Output: { count, error }.
export async function countRunPendingLines(runId) {
    const { count, error } = await withRetry(() =>
        supabase.from('planning_run_lines')
            .select('id', { count: 'exact', head: true })
            .eq('run_id', runId)
            .in('line_status', ['proposed', 'approved', 'scheduled']));
    return { count: count || 0, error };
}

// countRunReleasedLines — how many of a run's lines have been released. Guards
// against marking an all-skipped run "executed". Output: { count, error }.
export async function countRunReleasedLines(runId) {
    const { count, error } = await withRetry(() =>
        supabase.from('planning_run_lines')
            .select('id', { count: 'exact', head: true })
            .eq('run_id', runId)
            .eq('line_status', 'released'));
    return { count: count || 0, error };
}

// splitRunLine — turn one approved line into a timed batch group. The original
// row becomes batch 1 (its id preserved); N-1 sibling rows are inserted for the
// rest. Every row keeps the part's snapshots and carries its own override_qty +
// planned_release_date, all still 'approved', so each releases through the
// normal due queue on its date. Input: the existing line row, the batches array
// from computeSplitBatches, a split_group uuid, updatedBy.
// Output: { data: { survivor, siblings }, error } — the updated batch-1 row and
// the inserted rows, so callers can refresh their lists in place.
export async function splitRunLine(line, batches, splitGroup, updatedBy = null) {
    if (!line || !line.id || !Array.isArray(batches) || batches.length < 1) {
        return { data: null, error: new Error('splitRunLine: nothing to split') };
    }
    const total = batches.length;
    const first = batches[0];
    const up = await withRetry(() => supabase.from('planning_run_lines').update({
        override_qty: first.qty, planned_release_date: first.date,
        split_group: splitGroup, split_seq: 1, split_total: total,
        updated_by: updatedBy, updated_at: new Date().toISOString(),
    }).eq('id', line.id).select().single());
    if (up.error) return { data: null, error: up.error };

    const clone = b => ({
        run_id: line.run_id, part_number: line.part_number, level: line.level,
        gross: line.gross, on_hand_snap: line.on_hand_snap, open_wo_snap: line.open_wo_snap,
        in_flight_snap: line.in_flight_snap ?? null, requested_snap: line.requested_snap ?? null,
        open_po_snap: line.open_po_snap, min_stock_snap: line.min_stock_snap,
        basis_snap: line.basis_snap ?? null, net: line.net, recommended: line.recommended,
        action: line.action, flag: line.flag ?? null, action_source: line.action_source ?? null,
        qty_made_12mo: line.qty_made_12mo ?? null, qty_purchased_12mo: line.qty_purchased_12mo ?? null,
        required_date: line.required_date ?? null,
        demand_12mo: line.demand_12mo ?? null, kit_gross: line.kit_gross ?? null,
        override_qty: b.qty, hold: false, line_status: line.line_status || 'approved',
        planned_release_date: b.date,
        split_group: splitGroup, split_seq: b.seq, split_total: total, updated_by: updatedBy,
    });
    const rest = batches.slice(1).map(clone);
    let siblings = [];
    if (rest.length) {
        const ins = await withRetry(() => supabase.from('planning_run_lines').insert(rest).select());
        if (ins.error) return { data: null, error: ins.error };
        siblings = ins.data || [];
    }
    return { data: { survivor: up.data, siblings }, error: null };
}

// updatePlanningRun — patch run header (status, notes). Output: { data, error }.
export async function updatePlanningRun(id, fields) {
    const patch = { updated_at: new Date().toISOString() };
    ['status', 'notes', 'required_date'].forEach(k => {
        if (fields[k] !== undefined) patch[k] = fields[k];
    });
    const { data, error } = await supabase
        .from('planning_runs').update(patch).eq('id', id).select().single();
    return { data, error };
}

// fetchReleaseDueLines — approved lines whose release date has arrived,
// with their run's family name attached. Output: { data, error }.
export async function fetchReleaseDueLines(todayStr) {
    const { data: lines, error } = await withRetry(() =>
        supabase.from('planning_run_lines').select('*')
            .eq('line_status', 'approved')
            .lte('planned_release_date', todayStr)
            .order('planned_release_date', { ascending: true })
            .limit(500)
    );
    if (error) return { data: [], error };
    const runIds = [...new Set((lines || []).map(l => l.run_id))];
    let runMap = {};
    if (runIds.length) {
        const { data: runs } = await withRetry(() =>
            supabase.from('planning_runs').select('id, family_name').in('id', runIds));
        (runs || []).forEach(r => { runMap[r.id] = r.family_name; });
    }
    return { data: (lines || []).map(l => ({ ...l, family_name: runMap[l.run_id] || '' })), error: null };
}

// fetchApprovedLines — every approved line (the full send schedule), any date,
// with its run's family name. The panel shows all of these; only lines dated
// today-or-earlier actually release. Output: { data, error }.
export async function fetchApprovedLines() {
    const { data: lines, error } = await withRetry(() =>
        supabase.from('planning_run_lines').select('*')
            .eq('line_status', 'approved')
            .order('planned_release_date', { ascending: true })
            .limit(1000)
    );
    if (error) return { data: [], error };
    const runIds = [...new Set((lines || []).map(l => l.run_id))];
    let runMap = {};
    if (runIds.length) {
        const { data: runs } = await withRetry(() =>
            supabase.from('planning_runs').select('id, family_name').in('id', runIds));
        (runs || []).forEach(r => { runMap[r.id] = r.family_name; });
    }
    return { data: (lines || []).map(l => ({ ...l, family_name: runMap[l.run_id] || '' })), error: null };
}

// fetchScheduledLines — committed future lines (line_status='scheduled') that
// live on the scheduling view until their date arrives, + run family name.
// Output: { data, error }.
export async function fetchScheduledLines() {
    const { data: lines, error } = await withRetry(() =>
        supabase.from('planning_run_lines').select('*')
            .eq('line_status', 'scheduled')
            .order('planned_release_date', { ascending: true })
            .limit(1000)
    );
    if (error) return { data: [], error };
    const runIds = [...new Set((lines || []).map(l => l.run_id))];
    let runMap = {};
    if (runIds.length) {
        const { data: runs } = await withRetry(() =>
            supabase.from('planning_runs').select('id, family_name').in('id', runIds));
        (runs || []).forEach(r => { runMap[r.id] = r.family_name; });
    }
    return { data: (lines || []).map(l => ({ ...l, family_name: runMap[l.run_id] || '' })), error: null };
}

// createWoRequestFromLine — release a MAKE line into the WO Request pipeline
// at status='manager_review', i.e. straight into the Approve WO Creation queue
// (the planner step is skipped — Planning already sized and approved the line).
// `defaults` is the already-merged routing prefill (last WO actually made +
// learned part_approval_defaults — see _mergeReleaseRouting in planning-review.js);
// the manager fills any field neither source knew.
// NEVER assigns a job number and NEVER creates work_orders — managerFinalApproveWo
// stays the only gate (CLAUDE.md rule).
// Output: { data: wo_requests row, error }.
export async function createWoRequestFromLine(line, qty, defaults, createdBy) {
    const d = defaults || {};
    const { data, error } = await supabase
        .from('wo_requests')
        .insert({
            part_number: line.part_number,
            qty_to_make: qty,
            status: WO_REQUEST_STATUS_MANAGER_REVIEW,
            submitted_by: createdBy || 'Production Planning',
            request_date: new Date().toISOString().slice(0, 10),
            date_to_start: line.planned_release_date || null,
            production_notes: `Production Planning release — run ${line.run_id.slice(0, 8)}${line.family_name ? ` (${line.family_name})` : ''}`,
            fab: d.fab ?? null, fab_print: d.fab_print ?? null,
            weld: d.weld ?? null, weld_print: d.weld_print ?? null,
            assy_wo: d.assy_wo ?? null, color: d.color ?? null,
            bent_rolled_part: d.bent_rolled_part ?? null,
            set_up_time: d.set_up_time ?? null,
            estimated_lead_time: d.estimated_lead_time ?? null,
            staging_area: d.staging_area ?? null,
        })
        .select()
        .single();
    return { data, error };
}

// createPoRequestFromLine — release a BUY line into purchasing as a normal
// part request. Output: { data: purchasing_orders row, error }.
export async function createPoRequestFromLine(line, qty, createdBy) {
    const { data, error } = await supabase
        .from('purchasing_orders')
        .insert({
            request_type: 'part',
            part_number: line.part_number,
            qty_needed: qty,
            needed_by: line.required_date || null,
            requested_by: createdBy || 'Production Planning',
            requester_notes: `Production Planning release — run ${line.run_id.slice(0, 8)}${line.family_name ? ` (${line.family_name})` : ''}`,
        })
        .select()
        .single();
    return { data, error };
}

// fetchBandedParts — every part_planning row with a stock band (min_stock set).
// These are the queue/alert population. Output: { data: rows, error }.
export async function fetchBandedParts() {
    const { data, error } = await withRetry(() =>
        supabase.from('part_planning').select('*')
            .not('min_stock', 'is', null)
            .gt('min_stock', 0)
            .limit(2000)
    );
    return { data: data || [], error };
}

// fetchRoutingDefaultsForParts — learned dept routing per part (batch).
// Output: { data: { NORM: { fab, weld, assy_wo, ... } }, error }.
export async function fetchRoutingDefaultsForParts(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('part_approval_defaults').select('*')
                .in('part_number_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: map, error };
        (data || []).forEach(r => { if (!map[r.part_number_normalized]) map[r.part_number_normalized] = r; });
    }
    return { data: map, error: null };
}

// upsertPartPlanning — create/update one part's planning parameters
// (the bands editor's save). Output: { data, error }.
export async function upsertPartPlanning(fields) {
    const part = (fields.part_number || '').trim().toUpperCase();
    if (!part) return { data: null, error: new Error('Part number is required') };
    const row = { part_number: part, updated_at: new Date().toISOString() };
    ['min_stock', 'target_stock', 'min_batch_qty', 'order_multiple', 'lead_time_days']
        .forEach(k => { if (fields[k] !== undefined) row[k] = fields[k] === '' ? null : Number(fields[k]); });
    ['make_buy_override', 'notes', 'updated_by'].forEach(k => {
        if (fields[k] !== undefined) row[k] = fields[k] || null;
    });
    ['phantom', 'planning_hold'].forEach(k => {
        if (fields[k] !== undefined) row[k] = !!fields[k];
    });
    const { data, error } = await supabase
        .from('part_planning')
        .upsert(row, { onConflict: 'part_number_normalized' })
        .select()
        .single();
    return { data, error };
}

// ── Workload (Phase 4) ────────────────────────────────────────

// fetchWorkCenters — active work centers. Output: { data, error }.
export async function fetchWorkCenters() {
    const { data, error } = await withRetry(() =>
        // sort_order is the seeded shop-flow order (Saw → Laser → …); hand-added
        // centers have none and fall to the end, then alphabetically by dept/name.
        supabase.from('work_centers').select('*')
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('dept').order('name').limit(200));
    return { data: data || [], error };
}

// upsertWorkCenter / deleteWorkCenter — work-center editor writes.
export async function upsertWorkCenter(fields) {
    const row = {
        name: (fields.name || '').trim(),
        dept: (fields.dept || '').trim() || null,
        available_hours_week: Number(fields.available_hours_week) || 40,
    };
    if (!row.name) return { data: null, error: new Error('Name is required') };
    if (fields.id) row.id = fields.id;
    const { data, error } = await supabase.from('work_centers').upsert(row).select().single();
    return { data, error };
}
export async function deleteWorkCenter(id) {
    const { data, error } = await supabase.from('work_centers').delete().eq('id', id).select().single();
    return { data, error };
}

// fetchRoutingsForParts — part_routings rows per part (batch).
// Output: { data: { NORM: [rows] }, error }.
export async function fetchRoutingsForParts(parts) {
    const norms = [...new Set((parts || []).map(normalizePartNumber).filter(Boolean))];
    const map = {};
    for (let i = 0; i < norms.length; i += 100) {
        const { data, error } = await withRetry(() =>
            supabase.from('part_routings').select('*')
                .in('part_number_normalized', norms.slice(i, i + 100))
        );
        if (error) return { data: map, error };
        (data || []).forEach(r => (map[r.part_number_normalized] = map[r.part_number_normalized] || []).push(r));
    }
    return { data: map, error: null };
}

// upsertPartRouting / deletePartRouting — routing editor writes.
export async function upsertPartRouting(fields) {
    const part = (fields.part_number || '').trim().toUpperCase();
    if (!part || !fields.work_center_id) {
        return { data: null, error: new Error('Part number and work center are required') };
    }
    const row = {
        part_number: part,
        work_center_id: fields.work_center_id,
        seq: Number(fields.seq) || 1,
        setup_hours: Number(fields.setup_hours) || 0,
        run_hours_per_part: Number(fields.run_hours_per_part) || 0,
        source: fields.source || 'manual',
    };
    if (fields.id) row.id = fields.id;
    const { data, error } = await supabase.from('part_routings').upsert(row).select().single();
    return { data, error };
}
export async function deletePartRouting(id) {
    const { data, error } = await supabase.from('part_routings').delete().eq('id', id).select().single();
    return { data, error };
}

// fetchTimeStatsForPart — average actual hours per part from wo_time_sessions
// (the "Suggest from time data" seed for routings). Per-part, bounded query.
// Output: { data: { sessions, total_hours, total_qty, hours_per_part }, error }.
export async function fetchTimeStatsForPart(partNumber) {
    const norm = normalizePartNumber(partNumber);
    if (!norm) return { data: null, error: null };
    // Closed-out WOs move to completed_work_orders — query both for history.
    const [{ data: openWos, error: woErr }, { data: doneWos }] = await Promise.all([
        withRetry(() => supabase.from('work_orders').select('wo_number').eq('part_number', norm).limit(200)),
        withRetry(() => supabase.from('completed_work_orders').select('wo_number').eq('part_number', norm).limit(500)),
    ]);
    if (woErr) return { data: null, error: woErr };
    const woNums = [...new Set([...(openWos || []), ...(doneWos || [])].map(r => r.wo_number).filter(Boolean))];
    if (!woNums.length) return { data: { sessions: 0, total_hours: 0, total_qty: 0, hours_per_part: null }, error: null };
    const { data: wos, error: wErr } = await withRetry(() =>
        supabase.from('wo_time_sessions')
            .select('wo_number, department, duration_minutes, qty_this_session')
            .not('duration_minutes', 'is', null)
            .in('wo_number', woNums)
            .limit(1000)
    );
    if (wErr) return { data: null, error: wErr };
    let mins = 0, qty = 0;
    (wos || []).forEach(s => { mins += Number(s.duration_minutes) || 0; qty += Number(s.qty_this_session) || 0; });
    return {
        data: {
            sessions: (wos || []).length,
            total_hours: Math.round(mins / 6) / 10,
            total_qty: qty,
            hours_per_part: qty > 0 ? Math.round((mins / 60 / qty) * 100) / 100 : null,
        },
        error: null,
    };
}

// fetchApprovedLinesForWorkload — approved + released lines with a release
// date (the workload heatmap's demand side). Output: { data, error }.
export async function fetchApprovedLinesForWorkload() {
    const { data, error } = await withRetry(() =>
        supabase.from('planning_run_lines').select('*')
            .in('line_status', ['approved', 'released'])
            .not('planned_release_date', 'is', null)
            .limit(1000)
    );
    return { data: data || [], error };
}
