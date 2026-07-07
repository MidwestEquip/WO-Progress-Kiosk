-- ============================================================
-- eng-record-category-migration.sql
-- Adds record_category to engineering inquiry tables so a row can
-- be tagged as an Order, Issue/Warranty, or (engineering) Inquiry.
-- Values: 'order' | 'issue_warranty' | 'inquiry'. Default 'inquiry'
-- backfills all existing rows. Safe/additive (IF NOT EXISTS).
-- No new table => existing GRANTs already cover these tables.
-- ============================================================

ALTER TABLE public.eng_inquiries
  ADD COLUMN IF NOT EXISTS record_category TEXT DEFAULT 'inquiry';

ALTER TABLE public.eng_inquiries_completed
  ADD COLUMN IF NOT EXISTS record_category TEXT DEFAULT 'inquiry';
