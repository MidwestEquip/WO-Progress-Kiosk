-- ============================================================
-- Open Orders: per-line Backorder flag
-- ============================================================
-- Adds a boolean marking a single open_orders line as backordered — separated
-- from the rest of its sales order so the other lines can ship now while this
-- part is held. The backorder QUANTITY is not stored: it is simply this row's
-- to_ship (a partial backorder splits the line into a ship-now row + a new
-- backordered remainder row at backorder time — see pages/open-orders-shipping.js).
--
-- The flag is independent of status, so a backordered row keeps its real
-- workflow status (New/Picking, waiting-on a WO, etc.). Reversible in the UI.
--
-- Safe additive migration: NOT NULL DEFAULT false backfills every existing row
-- to false. No destructive statements.

ALTER TABLE public.open_orders
    ADD COLUMN IF NOT EXISTS backordered BOOLEAN NOT NULL DEFAULT false;

-- open_orders predates the Oct-30-2026 auto-expose cutoff and already carries
-- table-level grants; a table-level grant covers all present + future columns,
-- so this re-grant is a safe no-op that just documents intent. RLS remains the
-- row-level gate (unchanged posture — the rest of open_orders is anon-writable).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.open_orders TO anon, authenticated;

-- Refresh PostgREST's schema cache so supabase-js can read/write the new column
-- immediately (otherwise the first backordered write may silently drop the field).
NOTIFY pgrst, 'reload schema';
