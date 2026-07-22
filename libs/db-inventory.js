// ============================================================
// libs/db-inventory.js — Inventory, WO Requests, Open Orders queries
//
// Extracted from db.js to keep files under 500 lines.
// ============================================================

import { supabase, withRetry } from './db-shared.js';
import { detectTcMode, normalizePartNumber, normalizePartNumberStrict } from './utils.js';
import { SOURCE_OF_COUNT_MANUAL } from './config.js';

// ── WO Request → work_orders routing ─────────────────────────

// insertWorkOrdersFromRequest — creates work_order rows from an approved WO request.
// wo_number is intentionally null — it stays null until the official Alere WO# is entered.
// job_number is the internal tracking number assigned on approval.
export async function insertWorkOrdersFromRequest(req) {
    const inserts = [];
    const base = {
        wo_number:        null,
        job_number:       req.job_number    || null,
        wo_request_id:    req.id            || null,
        staging_area:     req.staging_area  || null,
        alere_bin:        req.alere_bin     || null,
        part_number:      (req.part_number  || '').trim().toUpperCase(),
        description:      (req.description  || ''),
        qty_required:     parseInt(req.qty_to_make, 10) || 1,
        wo_type:          'Unit',
        status:           'not_started',
        qty_completed:    0,
        priority:         0,
        production_notes: req.production_notes || null,
        traveller_id:     req.traveller_id    || null,
    };
    if (req.sales_order_number) base.sales_order = req.sales_order_number.trim();

    const weldArea  = (req.weld       || '').trim();
    const fab       = (req.fab        || '').trim().toLowerCase();
    const fabPrint  = (req.fab_print  || '').trim().toLowerCase();
    const weldPrint = (req.weld_print || '').trim().toLowerCase();

    if (fab === 'yes' && fabPrint === 'yes') {
        const fabRow = { ...base, department: 'Fab' };
        if (weldArea && weldPrint !== 'yes') {
            fabRow.fab_bring_to = weldArea;
        }
        inserts.push(fabRow);
    }

    if (weldArea && weldArea !== 'Paint' && weldPrint === 'yes') {
        const weldRow = {
            ...base,
            department: 'Weld',
            priority:   weldArea === 'Urgent' ? 5 : 0,
        };
        if (weldArea !== 'Urgent') weldRow.notes = `Weld Area: ${weldArea}`;
        inserts.push(weldRow);
    }

    if (req.assy_wo === 'Trac Vac Assy') {
        inserts.push({ ...base, department: 'Trac Vac Assy' });
    }
    if (req.assy_wo === 'Tru Cut Assy') {
        const tcMode = detectTcMode(req.part_number) || 'stock';
        inserts.push({ ...base, department: 'Tru Cut Assy', tc_job_mode: tcMode });
    }

    if (inserts.length === 0) return { data: [], error: null };
    return withRetry(() => supabase.from('work_orders').insert(inserts).select());
}

// ── WO Request queries ────────────────────────────────────────

export async function fetchApprovedWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .in('status', ['approved', 'in production'])
            .is('alere_wo_number', null)
            .eq('forecasted', false)
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// fetchCreatedWoRequests — all wo_requests that have an official alere_wo_number, newest first.
export async function fetchCreatedWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .not('alere_wo_number', 'is', null)
            .in('status', ['approved', 'in production', 'created', 'completed'])
            .order('created_date', { ascending: false })
            .order('created_at',   { ascending: false })
    );
}

export async function confirmCreateWo(id, woNumber, initials, date) {
    if (!id)       return { data: null, error: new Error('Missing request ID') };
    if (!woNumber) return { data: null, error: new Error('WO number is required') };
    if (!initials) return { data: null, error: new Error('Initials are required') };
    return withRetry(() =>
        supabase.from('wo_requests')
            .update({
                alere_wo_number:     woNumber.trim().toUpperCase(),
                created_by_initials: initials.trim().toUpperCase(),
                created_date:        date,
                status:              'in production'
            })
            .eq('id', id)
            .select()
    );
}

export async function fetchWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('forecasted', false)
            .eq('status', 'pending')
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// fetchActiveWosForPart — is there already an active (not-closed-out) work order for this
// part, or an open WO request? Matches dash/space-insensitively via the get_active_wos_for_part
// RPC. Input: part number string. Output: { data: { work_orders: [], requests: [] }, error }.
export async function fetchActiveWosForPart(partNumber) {
    const part = (partNumber || '').trim();
    if (!part) return { data: { work_orders: [], requests: [] }, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_active_wos_for_part', { p_part: part })
    );
    if (error) return { data: { work_orders: [], requests: [] }, error };
    return { data: data || { work_orders: [], requests: [] }, error: null };
}

// fetchManagerPendingWoRequests — requests awaiting manager final approval (status='manager_review').
export async function fetchManagerPendingWoRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('status', 'manager_review')
            .eq('forecasted', false)
            .order('request_date', { ascending: true })
            .order('created_at',   { ascending: true })
    );
}

// promoteDueForecasts — auto-promote forecasted requests whose start date has arrived.
// Flips forecasted=false for any row where forecasted=true AND forecast_date <= today,
// so the item drops out of WO Forecasting and reappears in the main WO Request list.
// forecast_date is stored as an ISO 'YYYY-MM-DD' string, so a lexical <= compare is correct.
// Input: none. Output: { data: promoted rows, error }. Non-fatal for callers.
export async function promoteDueForecasts() {
    const today = new Date().toISOString().slice(0, 10);
    return withRetry(() =>
        supabase.from('wo_requests')
            .update({ forecasted: false })
            .eq('forecasted', true)
            .not('forecast_date', 'is', null)
            .lte('forecast_date', today)
            .select()
    );
}

// fetchForecastedRequests — returns all wo_requests rows marked forecasted=true.
export async function fetchForecastedRequests() {
    return withRetry(() =>
        supabase.from('wo_requests')
            .select('*')
            .eq('forecasted', true)
            .order('forecast_date', { ascending: true })
            .order('created_at',    { ascending: true })
    );
}

export async function submitWoRequest(form) {
    if (!form?.part_number?.trim())  return { data: null, error: new Error('Part number is required') };
    if (!form?.submitted_by?.trim()) return { data: null, error: new Error('Submitted by is required') };
    return withRetry(() =>
        supabase.from('wo_requests').insert([{
            part_number:        form.part_number.trim().toUpperCase(),
            description:        (form.description        || '').trim() || null,
            sales_order_number: (form.sales_order_number || '').trim() || null,
            qty_on_order:       form.qty_on_order       ? parseFloat(form.qty_on_order)       : null,
            qty_in_stock:       form.qty_in_stock       ? parseFloat(form.qty_in_stock)       : null,
            qty_used_per_unit:  form.qty_used_per_unit  ? parseFloat(form.qty_used_per_unit)  : null,
            request_date:       form.request_date || new Date().toISOString().slice(0, 10),
            submitted_by:       form.submitted_by.trim(),
            is_assembly:        !!form.is_assembly,
            status:             'pending'
        }]).select()
    );
}

export async function updateWoRequest(id, updates) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.from('wo_requests').update(updates).eq('id', id).select()
    );
}

export async function deleteWoRequest(id) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.from('wo_requests').delete().eq('id', id).select()
    );
}

// updateAlereWoNumber — attach the official Alere/ERP WO# to an in-production request.
// Only updates wo_requests.alere_wo_number; work_orders.wo_number reconciled in a future patch.
export async function updateAlereWoNumber(id, woNumber) {
    if (!id)       return { data: null, error: new Error('Missing request ID') };
    if (!woNumber) return { data: null, error: new Error('WO number is required') };
    return withRetry(() =>
        supabase.from('wo_requests')
            .update({ alere_wo_number: woNumber.trim().toUpperCase() })
            .eq('id', id)
            .select()
    );
}

// updateWorkOrdersWoNumberByJobNumber — replaces the JOB- placeholder wo_number on all
// work_orders rows sharing this job_number once the official WO# is known.
export async function updateWorkOrdersWoNumberByJobNumber(jobNumber, woNumber) {
    if (!jobNumber) return { data: null, error: new Error('Missing job number') };
    if (!woNumber)  return { data: null, error: new Error('Missing WO number') };
    return withRetry(() =>
        supabase.from('work_orders')
            .update({ wo_number: woNumber.trim().toUpperCase() })
            .eq('job_number', jobNumber)
            .select('id, wo_number')
    );
}

// assignJobNumberIfMissing — calls RPC to assign job_number via sequence if not yet set.
// Race-safe (handled in Postgres). Returns { data: jobNumber (integer), error }.
export async function assignJobNumberIfMissing(id) {
    if (!id) return { data: null, error: new Error('Missing request ID') };
    return withRetry(() =>
        supabase.rpc('assign_job_number_if_missing', { p_request_id: id })
    );
}

// fetchPartDescription — look up a part's description via RPC (item_master first,
// issues_receipts fallback). The RPC strips spaces/dashes so TC27261 matches TC-27261.
// Returns { data: description string | null, error }.
export async function fetchPartDescription(partNumber) {
    if (!partNumber?.trim()) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.rpc('get_part_description', { p_part: partNumber.trim().toUpperCase() })
    );
    if (error) return { data: null, error };
    return { data: data || null, error: null };
}

// ── item_master manual inventory counts ──────────────────────

// fetchItemMasterByPart — look up the single item_master row for a part, matched
// dash/space-insensitively via the item_squashed generated column (index-backed,
// equals normalizePartNumberStrict). Deterministic order (latest manual count first)
// in case duplicate rows ever appear. Input: part # string. Output: { data: row|null, error }.
export async function fetchItemMasterByPart(partNumber) {
    const key = normalizePartNumberStrict(partNumber);
    if (!key) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('item_master')
            .select('id, item, descrip, store, bin, lonhand, manual_qty_check, date_manual_count, source_of_count')
            .eq('item_squashed', key)
            .order('date_manual_count', { ascending: false, nullsFirst: false })
            .limit(1)
    );
    if (error) return { data: null, error };
    return { data: (data && data[0]) || null, error: null };
}

// saveManualCount — write a manual physical count to one item_master row (by PK id).
// Sets manual_qty_check + date_manual_count + source_of_count='manual'. Leaves the
// Alere system estimate (lonhand) untouched. Inputs: id (uuid), qty (number), dateStr (YYYY-MM-DD).
export async function saveManualCount(id, qty, dateStr) {
    if (!id) return { data: null, error: new Error('Missing item_master row id') };
    return withRetry(() =>
        supabase.from('item_master')
            .update({
                manual_qty_check:  qty,
                date_manual_count: dateStr,
                source_of_count:   SOURCE_OF_COUNT_MANUAL,
            })
            .eq('id', id)
            .select()
    );
}

// ── Open Orders queries ───────────────────────────────────────

// findOpenOrderBySoAndPart — find a single open_orders row matching both SO# and part number.
// Used for WO Request → Open Orders status sync on submit, approve, and create.
export async function findOpenOrderBySoAndPart(soNumber, partNumber) {
    if (!soNumber || !partNumber) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('open_orders')
            .select('id, status, wo_po_number, deadline, part_number, chute_status')
            .eq('sales_order',  soNumber.trim())
            .eq('part_number',  partNumber.trim().toUpperCase())
            .limit(1)
    );
    return { data: (data && data[0]) || null, error };
}

// findOpenOrdersForWo — open_orders rows tied to a work order, for the office
// receive → board sync. Matches by WO/PO # (create-WO sync / paste auto-attach)
// OR by SO# + part # (rows never linked to the WO#). Bounded by exact-match
// filters. Inputs: WO#, SO#, part # strings (any may be blank). Output:
// { data: [{ id, status }], error }; data is [] when no usable filter.
export async function findOpenOrdersForWo(woNumber, salesOrder, partNumber) {
    const wo   = (woNumber   || '').trim();
    const so   = (salesOrder || '').trim();
    const part = (partNumber || '').trim().toUpperCase();
    const conds = [];
    if (wo)         conds.push(`wo_po_number.eq.${wo}`);
    if (so && part) conds.push(`and(sales_order.eq.${so},part_number.eq.${part})`);
    if (!conds.length) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('open_orders')
            .select('id, status')
            .or(conds.join(','))
    );
}

// findOpenOrdersByPartNumber — look up open_orders rows matching a part number
// that also have a sales_order value, for the WO Request SO# hint feature.
export async function findOpenOrdersByPartNumber(partNumber) {
    if (!partNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('open_orders')
            .select('id, part_number, sales_order, to_ship')
            .eq('part_number', partNumber.trim().toUpperCase())
            .not('sales_order', 'is', null)
    );
}

export async function fetchOpenOrders() {
    return withRetry(() =>
        supabase.from('open_orders')
            .select('*')
            .order('sort_order', { ascending: true })
    );
}

// fetchActiveWosForParts — active (not-completed) work orders for a set of part
// numbers, for the Open Orders import auto-attach. One query filtered by the
// pasted part list (bounded — never a full scan). Only WOs with an assigned
// wo_number are returned; a WO still awaiting its official Alere WO# has nothing
// to put in the row's WO/PO field. Because one WO spans multiple department
// rows (Fab/Weld/Assy) that share qty_required + sales_order, the caller
// collapses rows per wo_number. Input: array of part # strings. Output:
// { data: rows, error }; data is [] for empty/invalid input.
export async function fetchActiveWosForParts(parts) {
    const list = Array.from(new Set(
        (Array.isArray(parts) ? parts : [])
            .map(p => (p || '').trim().toUpperCase())
            .filter(Boolean)
    ));
    if (!list.length) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('wo_number, part_number, sales_order, qty_required, qty_completed, status')
            .in('part_number', list)
            .neq('status', 'completed')
            .not('wo_number', 'is', null)
    );
}

// checkWoNumberExists — returns true if any work_orders row already has this wo_number.
export async function checkWoNumberExists(woNumber) {
    if (!woNumber) return false;
    const { count, error } = await withRetry(() =>
        supabase.from('work_orders')
            .select('id', { count: 'exact', head: true })
            .eq('wo_number', woNumber.trim().toUpperCase())
    );
    if (error) return false;
    return (count || 0) > 0;
}

// fetchWoRequestProductionNote — the production_notes for the WO request that
// spawned a work order, matched by its job_number. One request per job_number.
// Input: job_number string. Output: { data: production_notes|null, error }.
export async function fetchWoRequestProductionNote(jobNumber) {
    if (!jobNumber) return { data: null, error: null };
    const { data, error } = await withRetry(() =>
        supabase.from('wo_requests')
            .select('production_notes')
            .eq('job_number', jobNumber)
            .limit(1)
            .maybeSingle()
    );
    if (error) return { data: null, error };
    return { data: data?.production_notes || null, error: null };
}

// fetchAllWorkOrdersByJobNumber — all WOs sharing a job_number (pending official WO#).
// Used by openCreatedWoDetail before alere_wo_number is set.
export async function fetchAllWorkOrdersByJobNumber(jobNumber) {
    if (!jobNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .eq('job_number', jobNumber)
    );
}

// fetchAllWorkOrdersByWoNumber — all WOs (any status) matching wo_number, full row for production modals.
export async function fetchAllWorkOrdersByWoNumber(woNumber) {
    if (!woNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('*')
            .eq('wo_number', woNumber.trim().toUpperCase())
    );
}

// fetchWorkOrdersByWoNumber — active WOs matching a given wo_number (for open order drill-down).
// Returns key production fields only; excludes completed orders.
export async function fetchWorkOrdersByWoNumber(woNumber) {
    if (!woNumber) return { data: [], error: null };
    return withRetry(() =>
        supabase.from('work_orders')
            .select('id,wo_number,part_number,description,department,status,operator,qty_completed,qty_required,start_date,due_date')
            .eq('wo_number', woNumber.trim())
            .neq('status', 'completed')
    );
}

export async function updateOpenOrder(id, updates) {
    if (!id) return { data: null, error: new Error('Missing order ID') };
    updates.updated_at = new Date().toISOString();
    return withRetry(() =>
        supabase.from('open_orders').update(updates).eq('id', id).select()
    );
}

export async function insertOpenOrders(rows) {
    if (!rows?.length) return { data: [], error: null };
    // Client-side ids make the withRetry insert idempotent — a lost-ack retry re-sends the same id and ON CONFLICT DO NOTHING drops the dup (open_orders.id is UUID PK).
    const withIds = rows.map(r => r.id ? r : { ...r, id: crypto.randomUUID() });
    return withRetry(() =>
        supabase.from('open_orders').upsert(withIds, { onConflict: 'id', ignoreDuplicates: true }).select()
    );
}

// ── Completed Orders queries: relocated to db-open-orders.js (Patch 4a) ──

// insertTraveller — creates a new traveller group record and returns its ID.
export async function insertTraveller() {
    return withRetry(() => supabase.from('travellers').insert([{}]).select().single());
}

// batchInsertWoRequests — inserts multiple wo_requests rows (subpart WOs on traveller approval).
export async function batchInsertWoRequests(rows) {
    if (!rows || !rows.length) return { data: [], error: null };
    return withRetry(() => supabase.from('wo_requests').insert(rows).select());
}
