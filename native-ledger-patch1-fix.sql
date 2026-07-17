-- ============================================================
-- native-ledger-patch1-fix.sql — corrective grant for Patch 1
--
-- Postgres requires SELECT privilege on the columns named in an
-- ON CONFLICT target. Every app ledger insert uses
-- ON CONFLICT (native_event_key), and Patch 1's REVOKE ALL removed
-- SELECT entirely → "permission denied for table issues_receipts"
-- on every emission.
--
-- Fix: column-level SELECT on native_event_key ONLY. This does NOT
-- expose ledger data: no SELECT RLS policy exists, so any actual
-- SELECT query still returns nothing; the grant only lets the
-- conflict arbiter do its duplicate check.
-- ============================================================

GRANT SELECT (native_event_key) ON public.issues_receipts TO anon, authenticated;
