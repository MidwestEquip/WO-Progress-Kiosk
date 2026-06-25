-- ============================================================
-- Patch 2 — ALL part-description lookups source = item_master
-- Redefines the two description RPCs to read from item_master first
-- (covers TCC units), falling back to issues_receipts for any part
-- not yet in item_master:
--   1. get_part_bin_and_desc(p_parts TEXT[])  — batch bin + description
--   2. get_part_description(p_part TEXT)       — single description (autofill)
-- Output signatures are UNCHANGED, so no JS changes are needed.
-- ============================================================

CREATE OR REPLACE FUNCTION get_part_bin_and_desc(p_parts TEXT[])
RETURNS TABLE(part_normalized TEXT, bin_location TEXT, description TEXT)
LANGUAGE sql SECURITY DEFINER AS $$
    WITH combined AS (
        -- Primary source: item_master (Alere item master + manual data)
        SELECT item_normalized        AS part_normalized,
               bin                     AS bin_location,
               descrip                 AS description,
               1                       AS src_priority,
               created_at
        FROM public.item_master
        WHERE item_normalized = ANY(p_parts)
        UNION ALL
        -- Fallback: transaction history (parts not present in item_master)
        SELECT part_number_normalized  AS part_normalized,
               bin                     AS bin_location,
               description,
               2                       AS src_priority,
               created_at
        FROM public.issues_receipts
        WHERE part_number_normalized = ANY(p_parts)
    )
    SELECT DISTINCT ON (part_normalized)
        part_normalized, bin_location, description
    FROM combined
    ORDER BY part_normalized,
             src_priority,             -- prefer item_master over issues_receipts
             (description IS NULL),     -- then a row that actually has a description
             (bin_location IS NULL),   -- then a row that has a bin
             created_at DESC;          -- newest tie-break
$$;


-- get_part_description: single-part autofill lookup. Matches space/dash-insensitively
-- (so TC27261 matches TC-27261), prefers item_master, falls back to issues_receipts.
-- Returns the most recent non-empty description, or NULL.
CREATE OR REPLACE FUNCTION get_part_description(p_part TEXT)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT d FROM (
        SELECT descrip AS d, 1 AS src_priority, created_at
        FROM public.item_master
        WHERE regexp_replace(item_normalized, '[ -]', '', 'g')
              = regexp_replace(UPPER(TRIM(p_part)), '[ -]', '', 'g')
          AND descrip IS NOT NULL AND btrim(descrip) <> ''
        UNION ALL
        SELECT description AS d, 2 AS src_priority, created_at
        FROM public.issues_receipts
        WHERE regexp_replace(part_number_normalized, '[ -]', '', 'g')
              = regexp_replace(UPPER(TRIM(p_part)), '[ -]', '', 'g')
          AND description IS NOT NULL AND btrim(description) <> ''
    ) s
    ORDER BY src_priority, created_at DESC
    LIMIT 1;
$$;
