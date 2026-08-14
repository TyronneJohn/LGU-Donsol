// Mirrors the `action` / `entity_type` values written by write_audit_log()
// and audit_generic_insert() across the migrations (see
// supabase/migrations/20260811100000_initial_schema.sql and later ones that
// call write_audit_log directly) — kept here as the single place the admin
// Audit Log page maps raw DB values to human-readable labels/tones.
export const AUDIT_ACTION_LABELS = {
  PROJECT_CREATED: 'Project Created',
  PROJECT_FIELD_UPDATED: 'Project Updated',
  PROJECT_PUBLISHED: 'Project Published',
  PROJECT_UNPUBLISHED: 'Project Unpublished',
  PROJECT_SUBMITTED: 'Submitted for Review',
  PROJECT_REVIEW_DECISION: 'Review Decision',
  PROJECT_ENDORSED_TO_BAC: 'Endorsed to BAC',
  PROJECT_DELETED: 'Project Deleted',
  PROJECT_READY_FOR_IMPLEMENTATION: 'Ready for Implementation',
  PROJECT_MONITORING_STARTED: 'Monitoring Started',
  PROJECT_MONITORING_COMPLETED: 'Monitoring Completed',
  PROCUREMENT_STATUS_CHANGED: 'Procurement Status Changed',
  PROCUREMENT_AWARDED: 'Contract Awarded',
  BID_EVALUATION_RECORDED: 'Bid Evaluation Recorded',
  BIDDER_RECORDED: 'Bidder Recorded',
  DOCUMENT_UPLOADED: 'Document Uploaded',
  ACCOMPLISHMENT_UPLOADED: 'Accomplishment Uploaded',
  IMAGE_UPLOADED: 'Image Uploaded',
}

export const AUDIT_ACTION_TONES = {
  PROJECT_CREATED: 'green',
  PROJECT_FIELD_UPDATED: 'blue',
  PROJECT_PUBLISHED: 'green',
  PROJECT_UNPUBLISHED: 'amber',
  PROJECT_SUBMITTED: 'blue',
  PROJECT_REVIEW_DECISION: 'blue',
  PROJECT_ENDORSED_TO_BAC: 'blue',
  PROJECT_DELETED: 'red',
  PROJECT_READY_FOR_IMPLEMENTATION: 'blue',
  PROJECT_MONITORING_STARTED: 'blue',
  PROJECT_MONITORING_COMPLETED: 'green',
  PROCUREMENT_STATUS_CHANGED: 'blue',
  PROCUREMENT_AWARDED: 'green',
  BID_EVALUATION_RECORDED: 'blue',
  BIDDER_RECORDED: 'neutral',
  DOCUMENT_UPLOADED: 'neutral',
  ACCOMPLISHMENT_UPLOADED: 'neutral',
  IMAGE_UPLOADED: 'neutral',
}

export const ENTITY_TYPE_LABELS = {
  project: 'Project',
  procurement: 'Procurement',
  procurement_bidder: 'Bidder',
  project_document: 'Project Document',
  procurement_document: 'Procurement Document',
  contractor_accomplishment: 'Accomplishment',
  project_image: 'Project Image',
}
