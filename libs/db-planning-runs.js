// ============================================================
// libs/db-planning-runs.js — planning runs, release-to-pipeline,
// queue + workload queries. Re-exported by db.js.
// (Split from db-planning.js to respect the 500-line cap.)
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { normalizePartNumber } from './utils.js';

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
        })
        .select()
        .single();
    if (hErr) return { data: null, error: hErr };
    const rows = (lines || []).map(l => ({
        run_id: header.id,
        part_number: l.part_number,
        level: l.level,
        gross: l.gross, on_hand_snap: l.on_hand, open_wo_snap: l.open_wo,
        open_po_snap: l.open_po, min_stock_snap: l.min_stock,
        net: l.net, recommended: l.recommended,
        action: l.action, flag: l.flag || null,
        required_date: run.required_date || null,
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

// createWoRequestFromLine — release a MAKE line into the normal WO Request
// pipeline as a status='pending' row, routing prefilled from learned
// part_approval_defaults when available. NEVER creates work_orders directly —
// the manager-approval flow stays the only gate (CLAUDE.md rule).
// Output: { data: wo_requests row, error }.
export async function createWoRequestFromLine(line, qty, defaults, createdBy) {
    const d = defaults || {};
    const { data, error } = await supabase
        .from('wo_requests')
        .insert({
            part_number: line.part_number,
            qty_to_make: qty,
            status: 'pending',
            submitted_by: createdBy || 'Production Planning',
            request_date: new Date().toISOString().slice(0, 10),
            date_to_start: line.planned_release_date || null,
            production_notes: `Production Planning release — run ${line.run_id.slice(0, 8)}${line.family_name ? ` (${line.family_name})` : ''}`,
            fab: d.fab ?? null, fab_print: d.fab_print ?? null,
            weld: d.weld ?? null, weld_print: d.weld_print ?? null,
            assy_wo: d.assy_wo ?? null, color: d.color ?? null,
            bent_rolled_part: d.bent_rolled_part ?? null,
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
        supabase.from('work_centers').select('*').order('dept').order('name').limit(200));
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
