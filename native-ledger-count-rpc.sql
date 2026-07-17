-- ============================================================
-- native-ledger-count-rpc.sql — import_inventory_count RPC
-- (Patch 9 item pulled forward: the Inventory Adjustment screen
--  now anchors live on-hand when a real count is entered.)
--
-- Clients deliberately cannot insert IC rows (the INSERT policy's
-- doctype whitelist excludes IC), so counts enter through this
-- SECURITY DEFINER function with server-side validation the client
-- cannot bypass. Each call INSERTS a fresh IC row (timestamped key),
-- so the part_on_hand AFTER trigger always fires and the ledger
-- keeps the full count history; a same-day recount simply becomes
-- the newest anchor. Requires Patches 1-2.
--
-- After running: regenerate schema.sql (gen-schema.ps1).
-- ============================================================

CREATE OR REPLACE FUNCTION public.import_inventory_count(
    p_part       text,
    p_qty        numeric,
    p_counted_by text
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public
    AS $$
DECLARE
    v_part text := upper(btrim(coalesce(p_part, '')));
    v_by   text := btrim(coalesce(p_counted_by, ''));
BEGIN
    IF length(v_part) < 1 OR length(v_part) > 100 THEN
        RAISE EXCEPTION 'invalid part number';
    END IF;
    IF p_qty IS NULL OR p_qty < 0 OR p_qty >= 100000 THEN
        RAISE EXCEPTION 'count quantity must be between 0 and 99999';
    END IF;
    IF v_by = '' THEN
        RAISE EXCEPTION 'counted_by is required';
    END IF;

    INSERT INTO issues_receipts
        (txn_date, part_number, part_number_normalized, doctype, trantype,
         qty, docid, source, native_event_key)
    VALUES
        (CURRENT_DATE, v_part, v_part, 'IC', 'C',
         p_qty,
         left('counted by: ' || v_by, 50),
         'native',
         'ic|' || v_part || '|' || to_char(now(), 'YYYYMMDDHH24MISS'))
    ON CONFLICT (native_event_key) DO NOTHING;  -- same-second replay collapses
END;
$$;
