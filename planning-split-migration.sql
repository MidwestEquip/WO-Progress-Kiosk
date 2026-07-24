-- ============================================================
-- planning-split-migration.sql — timed batch splitting (Planning Phase 2)
--
-- A split turns one approved planning line into N sibling planning_run_lines
-- rows (each its own override_qty + planned_release_date), tied together by a
-- split_group id. These columns just identify and label the group — the rows
-- release through the normal pipeline unchanged. All nullable: a line that was
-- never split reads NULL on all three (not part of any group).
--
-- Safe/additive: ADD COLUMN IF NOT EXISTS only. Rerunnable.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

ALTER TABLE public.planning_run_lines
    ADD COLUMN IF NOT EXISTS split_group uuid,     -- groups the batches of one split (NULL = not split)
    ADD COLUMN IF NOT EXISTS split_seq   integer,  -- 1..N position within the group
    ADD COLUMN IF NOT EXISTS split_total integer;  -- N — batches in the group (for the "i/N" label)

-- Fetch all batches of a group together (release-due + grid grouping).
CREATE INDEX IF NOT EXISTS planning_run_lines_split_idx
    ON public.planning_run_lines (split_group, split_seq);

-- planning_run_lines already has table-level grants to anon, authenticated
-- (planning-runs-migration.sql); new columns are covered.
