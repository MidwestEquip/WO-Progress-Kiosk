-- ============================================================
-- Completed Orders: carry the waiting_on link (v1.1.33 parity)
-- ============================================================
-- v1.1.33 added open_orders.waiting_on (jsonb WO/PO auto-link), and
-- shipOpenOrder() copies the FULL row into open_orders_completed on
-- ship/delete — same failure class as the backordered column:
--   "Could not find the 'waiting_on' column of 'open_orders_completed'"
-- After this, the two tables have identical row-copy columns (verified
-- against schema.sql July 16, 2026) — no further drift outstanding.
--
-- Safe additive migration: nullable jsonb, existing rows stay NULL
-- (all readers already null-check waiting_on). No destructive statements.

ALTER TABLE public.open_orders_completed
    ADD COLUMN IF NOT EXISTS waiting_on JSONB;

-- Refresh PostgREST's schema cache so supabase-js sees the new column
-- immediately (otherwise the first ship/delete after migrating may still fail).
NOTIFY pgrst, 'reload schema';
