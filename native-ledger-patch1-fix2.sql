-- ============================================================
-- native-ledger-patch1-fix2.sql — second corrective for Patch 1
--
-- Diagnosis (July 17): a plain INSERT as anon passes the RLS policy,
-- but the same insert with ON CONFLICT (native_event_key) DO NOTHING
-- fails with "new row violates row-level security policy". Postgres
-- requires the ON CONFLICT arbiter path to satisfy SELECT row-level
-- security, and issues_receipts has RLS enabled with NO SELECT
-- policy (default deny) — so every conflict-ignored app insert dies.
--
-- Fix: a SELECT policy scoped to native rows only.
--   * Alere rows (source <> 'native' — the cost history RLS was
--     protecting) still fail this policy → remain invisible.
--   * Native rows carry no cost (builder rule), and even they are
--     not practically readable: the only SELECT privilege anon holds
--     is the column-level grant on native_event_key (fix 1).
-- ============================================================

DROP POLICY IF EXISTS issues_receipts_native_select ON public.issues_receipts;
CREATE POLICY issues_receipts_native_select ON public.issues_receipts
    FOR SELECT TO anon, authenticated
    USING (source = 'native');

-- ── Verify (run after): this must now SUCCEED ───────────────────────
-- BEGIN;
-- SET LOCAL ROLE anon;
-- INSERT INTO public.issues_receipts
--     (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES
--     ('2026-07-17', 'ZZ-RLS-TEST', 'ZZ-RLS-TEST', 'SO', 'O', 5, 'native', 'rls|test|4')
-- ON CONFLICT (native_event_key) DO NOTHING;
-- ROLLBACK;
