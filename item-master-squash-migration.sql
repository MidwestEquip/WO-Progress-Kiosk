-- ============================================================
-- item_master — add dash/space-insensitive lookup key (item_squashed)
--
-- Strips ALL whitespace + hyphens and uppercases, so "TC-27261",
-- "TC 27261", and "TC27261" all resolve to one key. Used by the
-- Inventory Adjustment screen and the WO/PO "Real Count" display.
--
-- MUST stay identical to normalizePartNumberStrict() in libs/utils.js
--   ( partNumber.toUpperCase().replace(/[-\s]/g, '') )
-- or part lookups will silently miss. SQL [[:space:]-] == JS [-\s].
--
-- Generated STORED column → backfills existing rows automatically and
-- is physically materialized, so the b-tree index below is sargable for
-- .eq('item_squashed', ...) queries as the table grows.
-- regexp_replace / UPPER are IMMUTABLE → legal in a generated column.
-- ============================================================

ALTER TABLE public.item_master
    ADD COLUMN IF NOT EXISTS item_squashed TEXT
    GENERATED ALWAYS AS (regexp_replace(UPPER(item), '[[:space:]-]', '', 'g')) STORED;

CREATE INDEX IF NOT EXISTS idx_item_master_item_squashed
    ON public.item_master (item_squashed);

-- No GRANT needed: the existing table-level GRANT on public.item_master
-- (see item-master-migration.sql) already covers all current and future columns.
--
-- NOTE: ADD COLUMN IF NOT EXISTS will NOT redefine the expression if the
-- column already exists. To change the squash rule later you must
--   ALTER TABLE public.item_master DROP COLUMN item_squashed;
-- and then re-run this migration (another brief full-table rewrite).
