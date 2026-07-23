-- ============================================================
-- part-on-hand-baseline-migration.sql — On-hand estimate baseline (Patch 1)
--
-- Adds ONE nullable column to part_on_hand. Run in the Supabase SQL
-- editor. Safe, additive, idempotent — no data touched, old rows read NULL.
--
-- Purpose (see the on-hand baseline series):
--   part_on_hand.on_hand stays a pure native-delta accumulator (it starts
--   at 0 on a part's first native transaction). baseline_estimate holds a
--   FROZEN pre-cutover estimate of what was on the shelf at cutover, so the
--   effective on-hand of a never-counted part is:
--       max(0, baseline_estimate) + on_hand   (estimate + deltas since cutover)
--   Once a part is hard-counted (an IC row sets counted_at), the estimate is
--   ignored and effective on-hand = on_hand (count + deltas since the count).
--
--   The column is SET (not accumulated) by the seed script (Patch 2), which
--   makes that seed rerunnable. The on-hand trigger is NOT changed by this
--   patch — it keeps accumulating deltas and handling counts as before.
--
-- basis is derived, not stored: counted_at IS NULL  -> 'estimate'
--                               counted_at IS NOT NULL -> 'count'
--
-- After running: regenerate the schema snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

ALTER TABLE public.part_on_hand
    ADD COLUMN IF NOT EXISTS baseline_estimate numeric;

COMMENT ON COLUMN public.part_on_hand.baseline_estimate IS
    'Frozen pre-cutover estimate of on-hand at cutover (made+purchased-consumed-shipped, floored at 0 in reads). Effective on-hand for uncounted parts = max(0, baseline_estimate) + on_hand. Ignored once counted_at is set. NULL for parts never seeded.';

-- Table-level grants already cover new columns (GRANT ALL ON TABLE
-- part_on_hand TO anon, authenticated, service_role from native-ledger-patch2),
-- so no new GRANT is required. RLS SELECT-only policy is likewise unchanged.
