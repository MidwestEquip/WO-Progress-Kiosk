-- ============================================================
-- reconcile-part-on-hand.sql — Native Inventory Ledger maintenance script
--
-- NOT deployed app code. Run manually in the Supabase SQL editor
-- (service role) whenever you want to verify — or repair — the live
-- part_on_hand counters against the ledger (issues_receipts).
--
-- The ledger is the truth; part_on_hand is a trigger-maintained cache.
-- Expected drift sources this script detects:
--   * a native insert whose non-fatal client write was lost mid-flight
--   * a poisoned/pre-inserted native_event_key that silently suppressed
--     a legitimate later event (conflict-ignore semantics)
--   * any manual service-role edits to either table
--
-- Recompute rule (per part):
--   expected = qty of the LATEST IC row (by created_at), if any,
--            + signed deltas of all native rows created AFTER that IC
--   (no IC yet → expected = sum of all native deltas from zero)
-- Sign map mirrors issrec_native_apply_onhand() / libs/config.js:
--   MO/I +   PO/I +   MO/O −   SO/S −   SO/O 0   IC = set
-- ============================================================

-- ── STEP 1: report — parts whose live counter disagrees with the ledger
WITH latest_ic AS (
    SELECT DISTINCT ON (part_number_normalized)
           part_number_normalized, qty AS ic_qty, created_at AS ic_at
    FROM issues_receipts
    WHERE source = 'native' AND doctype = 'IC'
    ORDER BY part_number_normalized, created_at DESC
),
deltas AS (
    SELECT ir.part_number_normalized,
           SUM(CASE
                 WHEN ir.doctype IN ('MO','PO') AND ir.trantype = 'I' THEN  ir.qty
                 WHEN ir.doctype = 'MO'         AND ir.trantype = 'O' THEN -ir.qty
                 WHEN ir.doctype = 'SO'         AND ir.trantype = 'S' THEN -ir.qty
                 ELSE 0
               END) AS delta_sum
    FROM issues_receipts ir
    LEFT JOIN latest_ic ic USING (part_number_normalized)
    WHERE ir.source = 'native' AND ir.doctype <> 'IC'
      AND (ic.ic_at IS NULL OR ir.created_at > ic.ic_at)
    GROUP BY ir.part_number_normalized
),
expected AS (
    SELECT COALESCE(ic.part_number_normalized, d.part_number_normalized) AS part,
           COALESCE(ic.ic_qty, 0) + COALESCE(d.delta_sum, 0)             AS expected_on_hand,
           ic.ic_at
    FROM latest_ic ic
    FULL OUTER JOIN deltas d USING (part_number_normalized)
)
SELECT e.part,
       e.expected_on_hand,
       p.on_hand   AS live_on_hand,
       p.on_hand - e.expected_on_hand AS drift,
       e.ic_at     AS last_count,
       p.counted_at
FROM expected e
FULL OUTER JOIN part_on_hand p ON p.part_number_normalized = e.part
WHERE COALESCE(p.on_hand, 0) IS DISTINCT FROM COALESCE(e.expected_on_hand, 0)
ORDER BY abs(COALESCE(p.on_hand,0) - COALESCE(e.expected_on_hand,0)) DESC;

-- Zero rows = ledger and live counters agree. Done.


-- ── STEP 2: repair (OPTIONAL — uncomment and run only after reviewing
--            Step 1's output; overwrites live counters with ledger truth)
/*
WITH latest_ic AS (
    SELECT DISTINCT ON (part_number_normalized)
           part_number_normalized, qty AS ic_qty, created_at AS ic_at
    FROM issues_receipts
    WHERE source = 'native' AND doctype = 'IC'
    ORDER BY part_number_normalized, created_at DESC
),
deltas AS (
    SELECT ir.part_number_normalized,
           SUM(CASE
                 WHEN ir.doctype IN ('MO','PO') AND ir.trantype = 'I' THEN  ir.qty
                 WHEN ir.doctype = 'MO'         AND ir.trantype = 'O' THEN -ir.qty
                 WHEN ir.doctype = 'SO'         AND ir.trantype = 'S' THEN -ir.qty
                 ELSE 0
               END) AS delta_sum
    FROM issues_receipts ir
    LEFT JOIN latest_ic ic USING (part_number_normalized)
    WHERE ir.source = 'native' AND ir.doctype <> 'IC'
      AND (ic.ic_at IS NULL OR ir.created_at > ic.ic_at)
    GROUP BY ir.part_number_normalized
),
expected AS (
    SELECT COALESCE(ic.part_number_normalized, d.part_number_normalized) AS part,
           COALESCE(ic.ic_qty, 0) + COALESCE(d.delta_sum, 0)             AS expected_on_hand,
           ic.ic_at
    FROM latest_ic ic
    FULL OUTER JOIN deltas d USING (part_number_normalized)
)
INSERT INTO part_on_hand (part_number_normalized, on_hand, counted_at, updated_at)
SELECT part, expected_on_hand, ic_at, now() FROM expected
ON CONFLICT (part_number_normalized)
DO UPDATE SET on_hand    = EXCLUDED.on_hand,
              counted_at = COALESCE(EXCLUDED.counted_at, part_on_hand.counted_at),
              updated_at = now();
*/
