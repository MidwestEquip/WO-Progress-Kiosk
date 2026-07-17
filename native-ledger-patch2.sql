-- ============================================================
-- native-ledger-patch2.sql — Native Inventory Ledger, Patch 2 (Schema B)
--
-- Live on-hand: part_on_hand table + the two triggers that maintain it.
-- Run the whole file in the Supabase SQL editor as one script.
-- Requires Patch 1 (native-ledger-patch1.sql) to be applied first.
--
-- Design (red-teamed):
--   * TWO triggers, split on purpose:
--       BEFORE INSERT — normalizes part_number_normalized server-side.
--         Fires even for rows later dropped by ON CONFLICT DO NOTHING,
--         which is harmless (it only rewrites NEW, no side effects).
--       AFTER INSERT  — applies the on-hand delta. AFTER row triggers
--         fire ONLY for rows actually inserted, so conflict-ignored
--         duplicates (double-clicks, retries) can never touch on_hand.
--   * Sign vocabulary mirrors the INVENTORY_TXN constants in
--     libs/config.js (Patch 3) — config.js is the human-readable source
--     of truth; this trigger is its enforced mirror; the ledger + the
--     reconcile script (reconcile-part-on-hand.sql) is the arbiter.
--   * counted_at is NULL until the part's first IC (physical count) row.
--     The UI treats counted_at IS NULL as "not yet counted" and shows
--     the last-count date from it.
--   * This is the deliberate, user-approved carve-out to the
--     "never store logic in the database" rule: arithmetic bookkeeping
--     only — no classification, routing, or detection rules.
--
-- After running: regenerate the schema snapshot:
--   powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================


-- ── 1. part_on_hand — the live running count ────────────────────────

CREATE TABLE IF NOT EXISTS public.part_on_hand (
    part_number_normalized text PRIMARY KEY,
    on_hand    numeric NOT NULL DEFAULT 0,
    counted_at timestamp with time zone,          -- NULL until first IC row
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Clients read only; all writes come from the SECURITY DEFINER triggers
-- below (which run as table owner and bypass RLS). service_role keeps
-- full access for counts/backfills/repairs.
ALTER TABLE public.part_on_hand ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS part_on_hand_select ON public.part_on_hand;
CREATE POLICY part_on_hand_select ON public.part_on_hand
    FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON TABLE public.part_on_hand TO anon, authenticated;
GRANT ALL    ON TABLE public.part_on_hand TO service_role;


-- ── 2. BEFORE trigger — server-side normalization ───────────────────
-- Client-supplied part_number_normalized can never desync the ledger
-- from on_hand: it is always recomputed here for native rows.

CREATE OR REPLACE FUNCTION public.issrec_native_normalize() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
BEGIN
    NEW.part_number_normalized := upper(btrim(NEW.part_number));
    RETURN NEW;   -- must return NEW or the insert is silently suppressed
END;
$$;

DROP TRIGGER IF EXISTS trg_issrec_native_normalize ON public.issues_receipts;
CREATE TRIGGER trg_issrec_native_normalize
    BEFORE INSERT ON public.issues_receipts
    FOR EACH ROW
    WHEN (NEW.source = 'native')
    EXECUTE FUNCTION public.issrec_native_normalize();


-- ── 3. AFTER trigger — on-hand maintenance ──────────────────────────
-- Sign map (mirror of INVENTORY_TXN in libs/config.js):
--   MO/I  made          → +qty      PO/I  purchased/received → +qty
--   MO/O  consumed      → −qty      SO/S  shipped            → −qty
--   SO/O  sold-at-entry → no effect (nothing physically moved)
--   IC    physical count → SETS on_hand and stamps counted_at
-- Reversal rows carry negative qty, so the same map self-reverses
-- (e.g. a restore's negative SO/S adds the stock back).

CREATE OR REPLACE FUNCTION public.issrec_native_apply_onhand() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
    v_delta numeric;
BEGIN
    IF NEW.doctype = 'IC' THEN
        INSERT INTO part_on_hand (part_number_normalized, on_hand, counted_at, updated_at)
        VALUES (NEW.part_number_normalized, NEW.qty, now(), now())
        ON CONFLICT (part_number_normalized)
        DO UPDATE SET on_hand    = EXCLUDED.on_hand,
                      counted_at = now(),
                      updated_at = now();
        RETURN NULL;
    END IF;

    v_delta := CASE
        WHEN NEW.doctype IN ('MO', 'PO') AND NEW.trantype = 'I' THEN  NEW.qty
        WHEN NEW.doctype = 'MO'          AND NEW.trantype = 'O' THEN -NEW.qty
        WHEN NEW.doctype = 'SO'          AND NEW.trantype = 'S' THEN -NEW.qty
        ELSE NULL   -- SO/O and anything unmapped: no on-hand effect
    END;
    IF v_delta IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO part_on_hand (part_number_normalized, on_hand, updated_at)
    VALUES (NEW.part_number_normalized, v_delta, now())
    ON CONFLICT (part_number_normalized)
    DO UPDATE SET on_hand    = part_on_hand.on_hand + EXCLUDED.on_hand,
                  updated_at = now();
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_issrec_native_apply_onhand ON public.issues_receipts;
CREATE TRIGGER trg_issrec_native_apply_onhand
    AFTER INSERT ON public.issues_receipts
    FOR EACH ROW
    WHEN (NEW.source = 'native')
    EXECUTE FUNCTION public.issrec_native_apply_onhand();


-- ── 4. Verification (run manually in the SQL editor) ────────────────
-- Uses a fake part so no real metrics are touched; cleanup at the end.
-- Run each block and check the stated expectation.
--
-- -- a) MO/I before any count: stub row, counted_at NULL, on_hand 5
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES (CURRENT_DATE, '  zz-test-part ', 'WRONG', 'MO', 'I', 5, 'native', 'test|1');
-- SELECT * FROM part_on_hand WHERE part_number_normalized = 'ZZ-TEST-PART';
--    -- expect: on_hand=5, counted_at NULL. Note the BEFORE trigger fixed
--    -- the normalized value ('WRONG' → 'ZZ-TEST-PART') and trimmed/upper-cased.
--
-- -- b) duplicate key is a no-op for on_hand
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES (CURRENT_DATE, 'ZZ-TEST-PART', 'ZZ-TEST-PART', 'MO', 'I', 5, 'native', 'test|1')
-- ON CONFLICT (native_event_key) DO NOTHING;
-- SELECT on_hand FROM part_on_hand WHERE part_number_normalized = 'ZZ-TEST-PART';   -- still 5
--
-- -- c) IC sets the count and stamps counted_at
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key, docid)
-- VALUES (CURRENT_DATE, 'ZZ-TEST-PART', 'ZZ-TEST-PART', 'IC', 'C', 100, 'native', 'test|2', 'counted_by: your name');
-- SELECT * FROM part_on_hand WHERE part_number_normalized = 'ZZ-TEST-PART';   -- on_hand=100, counted_at set
--
-- -- d) consumption and ship subtract; sold-at-entry does nothing
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES (CURRENT_DATE, 'ZZ-TEST-PART', 'ZZ-TEST-PART', 'MO', 'O', 4, 'native', 'test|3');
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES (CURRENT_DATE, 'ZZ-TEST-PART', 'ZZ-TEST-PART', 'SO', 'O', 3, 'native', 'test|4');
-- SELECT on_hand FROM part_on_hand WHERE part_number_normalized = 'ZZ-TEST-PART';   -- 96
--
-- -- e) negative reversal self-reverses (restore of a shipped row)
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES (CURRENT_DATE, 'ZZ-TEST-PART', 'ZZ-TEST-PART', 'SO', 'S', 6, 'native', 'test|5');
-- INSERT INTO issues_receipts (txn_date, part_number, part_number_normalized, doctype, trantype, qty, source, native_event_key)
-- VALUES (CURRENT_DATE, 'ZZ-TEST-PART', 'ZZ-TEST-PART', 'SO', 'S', -6, 'native', 'test|5|rev');
-- SELECT on_hand FROM part_on_hand WHERE part_number_normalized = 'ZZ-TEST-PART';   -- back to 96
--
-- -- f) reconcile agrees (see reconcile-part-on-hand.sql) — expect zero mismatch rows
--
-- -- g) CLEANUP — remove all test data
-- DELETE FROM issues_receipts WHERE part_number_normalized = 'ZZ-TEST-PART';
-- DELETE FROM part_on_hand    WHERE part_number_normalized = 'ZZ-TEST-PART';
