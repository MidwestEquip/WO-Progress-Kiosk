-- ============================================================
-- Open Orders: "Waiting On" subparts blocking a ship
-- ============================================================
-- Adds a JSONB column holding an array of subparts an open order is waiting on,
-- each shaped { "part_number": "...", "wo_number": "..." }. The subpart WO's
-- live status is derived at read time from work_orders (never stored here).
--
-- Safe additive migration: existing rows read NULL (code guards with
-- Array.isArray(...) ? ... : []). No destructive statements.

ALTER TABLE public.open_orders
    ADD COLUMN IF NOT EXISTS waiting_on JSONB;

-- open_orders predates the Oct-30-2026 auto-expose cutoff and already carries
-- table-level grants; a table-level grant covers all present + future columns,
-- so this re-grant is a safe no-op that just documents intent. RLS remains the
-- row-level gate (unchanged posture — the rest of open_orders is anon-writable).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders TO anon, authenticated;

-- Refresh PostgREST's schema cache so supabase-js can read/write the new column
-- immediately (otherwise the first waiting_on write may silently drop the field).
NOTIFY pgrst, 'reload schema';
