-- ============================================================
-- planning-inflight-migration.sql — in-flight supply for Production
-- Planning (July 2026)
--
-- WHY: the planning engine's supply side counted only remaining work on
-- NON-completed work_orders. Parts that are finished but not yet closed
-- out are in neither that number nor part_on_hand (the native ledger only
-- emits at CLOSEOUT), so the planner recommends making them again.
--
-- Adds:
--   1. get_parts_wip_batch(p_parts) — the batch twin of get_part_wip.
--      Same per-WO department aggregation, many parts in one round trip
--      (a planning run needs hundreds; the single-part RPC would be
--      hundreds of calls).
--   2. planning_run_lines.in_flight_snap — audit snapshot of what was
--      subtracted as in-flight at calculation time.
--
-- Returns ROWS, not verdicts — bucketing stays in libs/utils.js
-- (bucketPartWip) per the CLAUDE.md "never store logic in the database"
-- rule. This function only matches, groups and aggregates.
--
-- DEPENDS ON: part-wip-migration.sql (shares its aggregation contract).
-- Apply that one first.
--
-- Safe: CREATE OR REPLACE of a NEW function + ADD COLUMN IF NOT EXISTS.
-- No existing function or column is touched. Rerunnable.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

-- ── 1. Batch WIP ────────────────────────────────────────────────────
-- Keyed by the SAME normalization as get_part_wip (upper/trim, '-' and
-- ' ' stripped) so a part resolves identically in both. Output is an
-- object keyed by the normalized part number:
--   { "TC27261": { "work_orders": [...], "requests": [...] }, ... }
-- Each work_orders entry has the same shape get_part_wip returns, so the
-- client can feed either through bucketPartWip unchanged.
--
-- Per-WO aggregation (identical to get_part_wip):
--   qty_required = MAX over the dept rows (all the same value)
--   qty_done     = MIN over the dept rows = qty that cleared EVERY
--                  department. MAX would overstate (Fab 50 / Weld 0 is
--                  0 finished, not 50).
CREATE OR REPLACE FUNCTION public.get_parts_wip_batch(p_parts text[]) RETURNS json
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    with norm as (
      select distinct replace(replace(upper(trim(p)), '-', ''), ' ', '') as k
      from unnest(coalesce(p_parts, '{}'::text[])) as p
      where replace(replace(upper(trim(p)), '-', ''), ' ', '') <> ''
    ),
    wos as (
      select
        replace(replace(upper(trim(w.part_number)), '-', ''), ' ', '') as k,
        coalesce(w.wo_number, 'job:' || w.job_number::text, 'id:' || w.id::text) as wo_key,
        max(w.wo_number)                  as wo_number,
        max(w.job_number)                 as job_number,
        max(coalesce(w.qty_required, 0))  as qty_required,
        min(coalesce(w.qty_completed, 0)) as qty_done,
        count(*)::int                     as dept_count
      from work_orders w
      where replace(replace(upper(trim(w.part_number)), '-', ''), ' ', '')
            in (select k from norm)
      group by 1, 2
    )
    select coalesce(json_object_agg(n.k, json_build_object(
      'work_orders', coalesce((
        select json_agg(json_build_object(
          'wo_key',       x.wo_key,
          'wo_number',    x.wo_number,
          'job_number',   x.job_number,
          'qty_required', x.qty_required,
          'qty_done',     x.qty_done,
          'dept_count',   x.dept_count,
          'erp_status',   t.erp_status,
          'qty_received', t.qty_received,
          'received_at',  t.received_at))
        from wos x
        -- Office receiving keys on wo_number when it exists; WOs still
        -- awaiting their official Alere WO# are tracked by job_number.
        left join lateral (
          select tr.erp_status, tr.qty_received, tr.received_at
          from wo_status_tracking tr
          where (x.wo_number is not null and tr.wo_number = x.wo_number)
             or (x.wo_number is null and x.job_number is not null and tr.job_number = x.job_number)
          order by tr.received_at desc nulls last, tr.created_at desc
          limit 1
        ) t on true
        where x.k = n.k
      ), '[]'::json),
      -- Pending requests are returned for DISPLAY only. Planning does not
      -- subtract them as supply (a request can still be rejected or
      -- revised) — the Review grid shows them in an advisory column so a
      -- released line is not silently re-planned before it is approved.
      'requests', coalesce((
        select json_agg(json_build_object(
          'id',          r.id,
          'status',      r.status,
          'qty_to_make', r.qty_to_make))
        from wo_requests r
        where r.forecasted = false
          and r.status in ('pending', 'manager_review')
          and replace(replace(upper(trim(r.part_number)), '-', ''), ' ', '') = n.k
      ), '[]'::json)
    )), '{}'::json)
    from norm n;
  $$;

GRANT ALL ON FUNCTION public.get_parts_wip_batch(p_parts text[]) TO anon;
GRANT ALL ON FUNCTION public.get_parts_wip_batch(p_parts text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_parts_wip_batch(p_parts text[]) TO service_role;

-- ── 2. Audit snapshot column ────────────────────────────────────────
-- What was subtracted as in-flight at calculation time (in production +
-- done-not-received + received-not-closed). Old rows stay NULL — the app
-- must treat NULL as "run predates in-flight netting", not as zero.
ALTER TABLE public.planning_run_lines
    ADD COLUMN IF NOT EXISTS in_flight_snap numeric;

-- Advisory only, never subtracted: pending request qty at calc time.
ALTER TABLE public.planning_run_lines
    ADD COLUMN IF NOT EXISTS requested_snap numeric;
