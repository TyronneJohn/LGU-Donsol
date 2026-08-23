-- Engineering saving the Approved Budget/Funding Source on a project under
-- review (ProjectReviewDetail.jsx handleSaveFields) previously notified no
-- one — MPDC had no signal that the technical review was done and the
-- project was ready to endorse to BAC, short of manually re-checking it.
-- This adds a dedicated notification category for exactly that moment,
-- kept separate from PROJECT_APPROVED (reserved for the endorsement itself
-- actually happening) so the two distinct events stay distinguishable in
-- the notification/audit trail.
alter type public.notification_category add value 'PROJECT_REVIEW_READY';
