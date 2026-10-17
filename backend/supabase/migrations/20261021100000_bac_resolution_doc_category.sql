-- Adds BAC_RESOLUTION as a procurement document category: the BAC Resolution
-- recommending award, which together with the Notice of Award is now required
-- before a procurement can be awarded (20261021110000_award_requires_documents.sql).
--
-- Kept in its own migration: a new enum value can't be used in the same
-- transaction that adds it.

alter type public.procurement_doc_category add value if not exists 'BAC_RESOLUTION' before 'NOTICE_OF_AWARD';
