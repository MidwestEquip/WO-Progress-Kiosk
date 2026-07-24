-- ============================================================
-- planning-work-centers-seed.sql — the shop's real work centers
-- (Planning Phase 3: schedule Gantt)
--
-- The Gantt's Y axis is work_centers grouped by dept. This seeds the 13 real
-- ones so the rows exist before any routing data does, and adds sort_order so
-- they display in shop-flow order (Saw first in Fab, etc.) instead of
-- alphabetically. Every row stays fully editable in the Workload tab.
--
-- Safe/additive: ADD COLUMN IF NOT EXISTS + INSERT … WHERE NOT EXISTS.
-- Rerunnable — a second run inserts nothing and overwrites nothing, so hours
-- you have already tuned in the Workload tab survive.
-- After applying: powershell -File C:\WO-Backups\scripts\gen-schema.ps1
-- ============================================================

-- Display order for the Gantt rows / Workload list. NULL on any hand-added
-- work center; the UI sorts those last, then by name.
ALTER TABLE public.work_centers
    ADD COLUMN IF NOT EXISTS sort_order integer;

-- Seed the 13. Matched on name (case-insensitive, trimmed) so a work center you
-- already typed in the Workload tab is left alone rather than duplicated —
-- work_centers_name_uniq enforces the same rule at the DB level as a backstop.
-- available_hours_week defaults to 40 — tune per machine in the Workload tab.
INSERT INTO public.work_centers (name, dept, available_hours_week, sort_order)
SELECT s.name, s.dept, 40, s.sort_order
FROM (VALUES
    -- Fab
    ('Saw',                 'Fab',   10),
    ('Laser',               'Fab',   20),
    ('Brake Press',         'Fab',   30),
    ('CNC Lathe',           'Fab',   40),
    ('CNC Mill',            'Fab',   50),
    -- Weld
    ('CoBot',               'Weld',  60),
    ('Welder 1',            'Weld',  70),
    ('Welder 2',            'Weld',  80),
    -- Paint
    ('Paint',               'Paint', 90),
    -- Assy
    ('Tru Cut Subassy',     'Assy', 100),
    ('Trac Vac Subassy',    'Assy', 110),
    ('Tru Cut Final Assy',  'Assy', 120),
    ('Trac Vac Final Assy', 'Assy', 130)
) AS s(name, dept, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM public.work_centers w
    WHERE upper(btrim(w.name)) = upper(btrim(s.name))
);

-- Backfill sort_order/dept on rows that already existed under these names, so a
-- work center typed in earlier joins the same ordering. Only fills NULLs —
-- never overwrites a dept or order you set deliberately.
UPDATE public.work_centers w
SET sort_order = s.sort_order,
    dept       = COALESCE(w.dept, s.dept)
FROM (VALUES
    ('Saw', 'Fab', 10), ('Laser', 'Fab', 20), ('Brake Press', 'Fab', 30),
    ('CNC Lathe', 'Fab', 40), ('CNC Mill', 'Fab', 50),
    ('CoBot', 'Weld', 60), ('Welder 1', 'Weld', 70), ('Welder 2', 'Weld', 80),
    ('Paint', 'Paint', 90),
    ('Tru Cut Subassy', 'Assy', 100), ('Trac Vac Subassy', 'Assy', 110),
    ('Tru Cut Final Assy', 'Assy', 120), ('Trac Vac Final Assy', 'Assy', 130)
) AS s(name, dept, sort_order)
WHERE upper(btrim(w.name)) = upper(btrim(s.name))
  AND w.sort_order IS NULL;

-- work_centers already has table-level grants to anon, authenticated
-- (work-centers-migration.sql); the new column is covered.
