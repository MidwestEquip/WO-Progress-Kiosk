-- ============================================================
-- Completed Orders: carry the per-line Backorder flag
-- ============================================================
-- v1.1.34 added open_orders.backordered, but shipOpenOrder() copies the FULL
-- row into open_orders_completed on ship/delete. Without a matching column
-- there, every ship/delete now fails with:
--   "Could not find the 'backordered' column of 'open_orders_completed'"
-- Adding the same column fixes the copy and preserves the flag on completed
-- rows so Restore round-trips it back to open_orders intact.
--
-- Safe additive migration: NOT NULL DEFAULT false backfills every existing
-- completed row to false. No destructive statements.

ALTER TABLE public.open_orders_completed
    ADD COLUMN IF NOT EXISTS backordered BOOLEAN NOT NULL DEFAULT false;

-- open_orders_completed predates the Oct-30-2026 auto-expose cutoff and
-- already carries table-level grants (which cover future columns); re-grant
-- documents intent as a safe no-op. RLS posture unchanged.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders_completed TO anon, authenticated;

-- Refresh PostgREST's schema cache so supabase-js sees the new column
-- immediately (otherwise the first ship/delete after migrating may still fail).
NOTIFY pgrst, 'reload schema';
