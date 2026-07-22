-- ============================================================
-- part-wip-migration.sql — WO Request "pipeline" data (July 2026)
--
-- Adds get_part_wip(p_part): everything for a part that is in flight but
-- NOT yet reflected in part_on_hand. The native ledger only emits at
-- CLOSEOUT, so requested / in-production / completed-not-received /
-- received-not-closed quantities are all invisible to "In Stock (Software)".
--
-- Returns ROWS, not verdicts. Bucketing + classification lives in
-- libs/utils.js (bucketPartWip) per the CLAUDE.md "never store logic in
-- the database" rule. This function only matches, groups and aggregates.
--
-- Safe: CREATE OR REPLACE of a NEW function only. No table changes, no
-- existing function touched. Rerunnable.
-- ============================================================

-- One row per WORK ORDER (not per department row). work_orders holds one
-- row per department (Fab/Weld/Assy) sharing wo_number + qty_required, so:
--   qty_required = MAX over the dept rows (they are all the same value)
--   qty_done     = MIN over the dept rows = qty that cleared EVERY
--                  department, i.e. what is actually finished. MAX would
--                  overstate (Fab 50 / Weld 0 is 0 finished, not 50).
-- Closed-out WOs have already been archived out of work_orders, so they
-- drop out naturally; erp_status is returned anyway so the client can
-- skip 'closed' defensively.
CREATE OR REPLACE FUNCTION public.get_part_wip(p_part text) RETURNS json
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    with norm as (
      select replace(replace(upper(trim(p_part)), '-', ''), ' ', '') as k
    ),
    wos as (
      select
        coalesce(w.wo_number, 'job:' || w.job_number::text, 'id:' || w.id::text) as wo_key,
        max(w.wo_number)                  as wo_number,
        max(w.job_number)                 as job_number,
        max(coalesce(w.qty_required, 0))  as qty_required,
        min(coalesce(w.qty_completed, 0)) as qty_done,
        count(*)::int                     as dept_count
      from work_orders w, norm
      where norm.k <> ''
        and replace(replace(upper(trim(w.part_number)), '-', ''), ' ', '') = norm.k
      group by 1
    )
    select json_build_object(
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
      ), '[]'::json),
      -- Requests that have NOT yet become work_orders. 'in production'
      -- requests are deliberately excluded — their work_orders rows are
      -- already counted above, and counting both would double up.
      'requests', coalesce((
        select json_agg(json_build_object(
          'id',          r.id,
          'status',      r.status,
          'qty_to_make', r.qty_to_make))
        from wo_requests r, norm
        where norm.k <> ''
          and r.forecasted = false
          and r.status in ('pending', 'manager_review')
          and replace(replace(upper(trim(r.part_number)), '-', ''), ' ', '') = norm.k
      ), '[]'::json)
    );
  $$;

GRANT ALL ON FUNCTION public.get_part_wip(p_part text) TO anon;
GRANT ALL ON FUNCTION public.get_part_wip(p_part text) TO authenticated;
GRANT ALL ON FUNCTION public.get_part_wip(p_part text) TO service_role;
