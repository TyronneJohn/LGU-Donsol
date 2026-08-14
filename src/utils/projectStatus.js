// Mirrors the public.project_status enum (supabase/migrations/20260811100000_initial_schema.sql).
export const PROJECT_STATUS_LABELS = {
  DRAFT: 'Draft',
  SUBMITTED_FOR_REVIEW: 'Submitted for Review',
  RETURNED_FOR_REVISION: 'Returned for Revision',
  REJECTED: 'Rejected',
  APPROVED: 'Endorsed to BAC',
  FOR_PROCUREMENT: 'For Procurement',
  FOR_IMPLEMENTATION: 'For Implementation',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled',
}

export const PROJECT_STATUS_TONES = {
  DRAFT: 'neutral',
  SUBMITTED_FOR_REVIEW: 'blue',
  RETURNED_FOR_REVISION: 'amber',
  REJECTED: 'red',
  APPROVED: 'green',
  FOR_PROCUREMENT: 'blue',
  FOR_IMPLEMENTATION: 'blue',
  ONGOING: 'blue',
  COMPLETED: 'green',
  ON_HOLD: 'amber',
  CANCELLED: 'red',
}

// Statuses in which Engineering can view site monitoring for a project it
// owns, including the pre-implementation queue (APPROVED/FOR_PROCUREMENT)
// so it's visible while BAC procurement is in progress — just not editable
// yet. COMPLETED is view-only.
export const MONITORING_VISIBLE_STATUSES = [
  'APPROVED',
  'FOR_PROCUREMENT',
  'FOR_IMPLEMENTATION',
  'ONGOING',
  'COMPLETED',
]

// Statuses in which Engineering can actually submit a monitoring update.
// Mirrors the status list baked into the updates_insert_engineering /
// images_insert_engineering RLS policies and the apply_monitoring_progress()
// trigger (20260812110000_bac_procurement_module.sql) — monitoring only
// opens once BAC has signed a contract (FOR_IMPLEMENTATION).
export const MONITORING_EDITABLE_STATUSES = ['FOR_IMPLEMENTATION', 'ONGOING']

// Mirrors the public.procurement_status enum.
export const PROCUREMENT_STATUS_LABELS = {
  NOT_STARTED: 'Not Started',
  BIDDING: 'Bidding',
  BID_EVALUATION: 'Bid Evaluation',
  AWARDED: 'Awarded',
  CONTRACT_SIGNED: 'Contract Signed',
  COMPLETED: 'Completed',
}

export const PROCUREMENT_STATUS_TONES = {
  NOT_STARTED: 'neutral',
  BIDDING: 'blue',
  BID_EVALUATION: 'blue',
  AWARDED: 'amber',
  CONTRACT_SIGNED: 'green',
  COMPLETED: 'green',
}

// Statuses in which BAC can open or continue procurement on a project.
// Mirrors procurement_insert_bac's RLS check.
export const PROCUREMENT_ELIGIBLE_STATUSES = ['APPROVED', 'FOR_PROCUREMENT']

// Statuses relevant to BAC beyond just "can open procurement" — includes
// FOR_IMPLEMENTATION/ONGOING/COMPLETED so BAC's Geo Mapping view keeps
// showing a project it already procured, not just ones awaiting action.
export const PROCUREMENT_RELEVANT_STATUSES = [
  'APPROVED',
  'FOR_PROCUREMENT',
  'FOR_IMPLEMENTATION',
  'ONGOING',
  'COMPLETED',
]

// Mirrors the public.bid_status enum.
export const BID_STATUS_LABELS = {
  SUBMITTED: 'Submitted',
  QUALIFIED: 'Qualified',
  DISQUALIFIED: 'Disqualified',
  WITHDRAWN: 'Withdrawn',
}

export const BID_STATUS_TONES = {
  SUBMITTED: 'neutral',
  QUALIFIED: 'green',
  DISQUALIFIED: 'red',
  WITHDRAWN: 'amber',
}
