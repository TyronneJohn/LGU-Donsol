-- Adds PROGRESS_REPORT as a project document category: the file Engineering
-- attaches to each monitoring update. Until now that file was filed as
-- PROGRAM_OF_WORKS, which mixed it with the real POW (submitted once, during
-- review) — see 20261024110000_progress_report_on_updates.sql.
--
-- Kept in its own migration: a new enum value can't be used in the same
-- transaction that adds it.

alter type public.doc_category add value if not exists 'PROGRESS_REPORT' after 'PROGRAM_OF_WORKS';
