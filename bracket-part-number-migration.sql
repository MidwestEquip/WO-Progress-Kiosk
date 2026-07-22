-- ============================================================
-- Open Orders: bracket_part_number on chute rows
-- ============================================================
-- Chute rows track a separate Chute status and Bracket status. This adds a
-- saved, editable bracket part number surfaced under the Bracket status in the
-- Open Orders board (chute rows only; NULL/blank for everything else).
--
-- Added to BOTH open_orders and open_orders_completed: shipOpenOrder() copies
-- the FULL row into the completed table on ship/delete, so a missing column
-- there would break the copy and drop the value on Restore.
--
-- Safe additive migration: nullable TEXT, no default needed (old rows stay
-- NULL, handled gracefully in code). No destructive statements.

ALTER TABLE public.open_orders
    ADD COLUMN IF NOT EXISTS bracket_part_number TEXT;

ALTER TABLE public.open_orders_completed
    ADD COLUMN IF NOT EXISTS bracket_part_number TEXT;

-- Both tables predate the Oct-30-2026 auto-expose cutoff and already carry
-- table-level grants (which cover future columns); re-grant documents intent
-- as a safe no-op. RLS posture unchanged.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders           TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders_completed TO anon, authenticated;

-- Refresh PostgREST's schema cache so supabase-js sees the new column
-- immediately.
NOTIFY pgrst, 'reload schema';
