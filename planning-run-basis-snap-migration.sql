-- ============================================================
-- planning-run-basis-snap-migration.sql — Grid basis label (Patch 4b)
--
-- One nullable column: records whether each run line's on_hand_snap was a
-- physical count or an estimate at calc time, so the Review grid can tag it.
-- Additive, safe, idempotent. Old run lines read NULL (grid shows no tag).
-- Run in the Supabase SQL editor.
--
-- After running: regenerate the schema snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

ALTER TABLE public.planning_run_lines
    ADD COLUMN IF NOT EXISTS basis_snap text;

COMMENT ON COLUMN public.planning_run_lines.basis_snap IS
    'On-hand basis at calc time: ''count'' | ''estimate'' | NULL (pre-4b runs). Mirrors fetchOnHandForParts basis for on_hand_snap; display-only.';

-- planning_run_lines already has table-level grants to anon, authenticated,
-- service_role (planning-runs-migration.sql); new columns are covered.
