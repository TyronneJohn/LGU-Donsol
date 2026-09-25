// Rule-based decision-support flags for a project under implementation.
// Pure functions over data already loaded by the page — no ML, just the
// schedule-variance/staleness math a human reviewer would otherwise have to
// do by hand when scanning a project list.

import { formatDate } from './format'

const STALE_AFTER_DAYS = 14
const SCHEDULE_VARIANCE_PCT = 15

function daysBetween(a, b) {
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.floor((a.getTime() - b.getTime()) / msPerDay)
}

export function getMonitoringFlags(project, updates) {
  const flags = []
  if (!project) return flags

  const today = new Date()
  const latestUpdate = updates?.[0] ?? null

  if (project.status === 'ONGOING' && latestUpdate) {
    const daysSinceUpdate = daysBetween(today, new Date(latestUpdate.report_date))
    if (daysSinceUpdate > STALE_AFTER_DAYS) {
      flags.push({
        type: 'STALE',
        severity: 'warning',
        message: `No monitoring update in ${daysSinceUpdate} days.`,
      })
    }
  }

  if (project.status !== 'COMPLETED' && project.status !== 'CANCELLED' && project.end_date_planned) {
    const daysPastDeadline = daysBetween(today, new Date(project.end_date_planned))
    if (daysPastDeadline > 0) {
      flags.push({
        type: 'OVERDUE',
        severity: 'critical',
        message: `${daysPastDeadline} day(s) past the target completion date.`,
      })
    }
  }

  if (project.status === 'ONGOING' && project.start_date_planned && project.end_date_planned) {
    const start = new Date(project.start_date_planned)
    const end = new Date(project.end_date_planned)
    const totalDays = daysBetween(end, start)
    if (totalDays > 0) {
      const elapsedDays = Math.min(Math.max(daysBetween(today, start), 0), totalDays)
      const expectedPct = (elapsedDays / totalDays) * 100
      const actualPct = Number(latestUpdate?.progress_percentage ?? 0)
      if (expectedPct - actualPct > SCHEDULE_VARIANCE_PCT) {
        flags.push({
          type: 'BEHIND_SCHEDULE',
          severity: 'warning',
          message: `Reported ${actualPct.toFixed(0)}% complete; ~${expectedPct.toFixed(0)}% expected by now.`,
        })
      }
    }
  }

  return flags
}

export function getFlagTone(severity) {
  return severity === 'critical' ? 'red' : 'amber'
}

// =========================================================================
// AUTOMATIC DSS DECISION ENGINE
// =========================================================================
// evaluateProjectDss() turns the same raw project/monitoring data used by
// getMonitoringFlags() above into a single, explainable, deterministic
// DECISION: a condition, a severity, a system-determined action, who is
// responsible, and whether follow-up monitoring is required — instead of
// leaving "what do we do about this" to the office reviewing the flags.
//
// It never performs a legally/administratively irreversible action itself
// (reject a project, cancel procurement, terminate a contract, change
// project_status). It only ever recommends/requires monitoring, escalation,
// or verification — those stay inside their existing authorized workflows.
//
// This mirrors — and must stay in sync with — the SQL copy of these same
// rules in evaluate_project_dss() (see the DSS migration). That copy is
// what actually records the decision and fires notifications from the
// database side, triggered by data changes; this copy is what renders
// instantly on page load, including the one case a database trigger can
// never catch by itself: a project doing nothing while the calendar alone
// crosses its planned end date.

// "Critical" thresholds are exactly double the existing routine thresholds
// above (STALE_AFTER_DAYS, SCHEDULE_VARIANCE_PCT) — a deliberate, documented
// multiplier rather than an arbitrary new number, so a CRITICAL_DELAY is
// legible as "twice as bad as what would already have been flagged."
const CRITICAL_DAYS_PAST_DEADLINE = 30
const CRITICAL_VARIANCE_PCT = 30
const CRITICAL_STALE_AFTER_DAYS = 30
// Midpoint between "behind schedule" and "critical" — BEHIND_SCHEDULE itself
// escalates from MEDIUM to HIGH severity once the gap crosses this, rather
// than jumping straight from MEDIUM to CRITICAL_DELAY's own overdue-gated rule.
const HIGH_VARIANCE_PCT = (SCHEDULE_VARIANCE_PCT + CRITICAL_VARIANCE_PCT) / 2

// DSS only evaluates schedule-based conditions once a project has actually
// entered implementation. Evaluating OVERDUE/BEHIND_SCHEDULE against a
// project still awaiting approval or procurement (APPROVED, FOR_PROCUREMENT)
// would flag a false OVERDUE for work that hasn't started yet.
const DSS_IMPLEMENTATION_STATUSES = ['FOR_IMPLEMENTATION', 'ONGOING']

const RESPONSIBLE = {
  ENGINEERING_ONLY: { office: 'Engineering', notify: ['engineering'] },
  ENGINEERING_MPDC: { office: 'Engineering & MPDC', notify: ['engineering', 'mpdc'] },
  ENGINEERING_MPDC_ADMIN: { office: 'Engineering, MPDC & Admin', notify: ['engineering', 'mpdc', 'admin'] },
}

function buildDecision(code, label, severity, reason, action, responsible, inputs, options = {}) {
  const { requiresFollowUp = true, supportingConditions = [] } = options
  return {
    code,
    label,
    severity, // LOW | MEDIUM | HIGH | CRITICAL
    reason,
    action,
    responsibleOffice: responsible.office,
    notify: responsible.notify,
    requiresFollowUp,
    supportingConditions,
    evaluatedAt: new Date().toISOString(),
    inputs,
  }
}

// Returns null for projects the DSS has nothing to say about yet (not in an
// implementation-relevant status) — callers should simply not render a panel
// in that case, same as today's silent behavior for those statuses.
export function evaluateProjectDss(project, updates) {
  if (!project) return null

  if (project.status === 'COMPLETED') {
    return buildDecision(
      'COMPLETED',
      'Completed',
      'LOW',
      'Project implementation has been marked complete.',
      'No further monitoring action required.',
      RESPONSIBLE.ENGINEERING_ONLY,
      {},
      { requiresFollowUp: false },
    )
  }

  if (!DSS_IMPLEMENTATION_STATUSES.includes(project.status)) {
    return null
  }

  const today = new Date()
  const latestUpdate = updates?.[0] ?? null
  const actualProgress = Number(latestUpdate?.progress_percentage ?? 0)
  const daysSinceLastUpdate = latestUpdate ? daysBetween(today, new Date(latestUpdate.report_date)) : null

  // Expected progress: linear interpolation across the planned schedule,
  // clamped so a project not yet started or already past its end date never
  // produces a negative or >100% expected value. null (not 0) when either
  // planned date is missing, so downstream checks can tell "no schedule to
  // compare against" apart from "exactly on schedule."
  let expectedProgress = null
  if (project.start_date_planned && project.end_date_planned) {
    const start = new Date(project.start_date_planned)
    const end = new Date(project.end_date_planned)
    const totalDays = daysBetween(end, start)
    if (totalDays > 0) {
      const elapsedDays = Math.min(Math.max(daysBetween(today, start), 0), totalDays)
      expectedProgress = (elapsedDays / totalDays) * 100
    }
  }

  const daysPastDeadline = project.end_date_planned ? daysBetween(today, new Date(project.end_date_planned)) : null
  const isOverdue = daysPastDeadline !== null && daysPastDeadline > 0 && actualProgress < 100
  const variance = expectedProgress !== null ? expectedProgress - actualProgress : null
  const isBehindSchedule = variance !== null && variance > SCHEDULE_VARIANCE_PCT
  const isStale = daysSinceLastUpdate !== null && daysSinceLastUpdate > STALE_AFTER_DAYS

  const supportingConditions = []
  if (isStale) supportingConditions.push('MONITORING_REQUIRED')
  if (isOverdue) supportingConditions.push('OVERDUE')
  if (isBehindSchedule) supportingConditions.push('BEHIND_SCHEDULE')

  const inputs = {
    actualProgress,
    expectedProgress: expectedProgress !== null ? Number(expectedProgress.toFixed(1)) : null,
    variance: variance !== null ? Number(variance.toFixed(1)) : null,
    daysPastDeadline,
    daysSinceLastUpdate,
    plannedEndDate: project.end_date_planned,
  }

  // 1. COMPLETION_READY takes precedence over everything else — 100%
  //    reported progress is a positive signal even on an overdue project.
  if (actualProgress >= 100 && project.status === 'ONGOING') {
    return buildDecision(
      'COMPLETION_READY',
      'Completion Ready',
      'MEDIUM',
      `Latest monitoring update reports 100% physical progress as of ${formatDate(latestUpdate?.report_date)}.`,
      'Perform completion verification and update the project record to Completed once confirmed.',
      RESPONSIBLE.ENGINEERING_MPDC,
      inputs,
      { supportingConditions },
    )
  }

  // 2. OVERDUE, escalating to CRITICAL_DELAY when it's badly overdue, badly
  //    behind on progress, or monitoring has also gone stale for a long time
  //    — any one of those three, on top of already being overdue, is
  //    "critical" rather than routine.
  if (isOverdue) {
    const criticalReasons = []
    if (daysPastDeadline >= CRITICAL_DAYS_PAST_DEADLINE) {
      criticalReasons.push(`${daysPastDeadline} days past the planned completion date`)
    }
    if (variance !== null && variance >= CRITICAL_VARIANCE_PCT) {
      criticalReasons.push(`progress is ${variance.toFixed(0)} points behind the expected schedule`)
    }
    if (daysSinceLastUpdate !== null && daysSinceLastUpdate >= CRITICAL_STALE_AFTER_DAYS) {
      criticalReasons.push(`no monitoring update in ${daysSinceLastUpdate} days`)
    }

    if (criticalReasons.length > 0) {
      return buildDecision(
        'CRITICAL_DELAY',
        'Critical Delay',
        'CRITICAL',
        `Project is significantly behind expected progress and has exceeded its planned completion date (${criticalReasons.join('; ')}).`,
        'Immediate Engineering assessment required. Escalate to MPDC and Admin for corrective action planning.',
        RESPONSIBLE.ENGINEERING_MPDC_ADMIN,
        inputs,
        { supportingConditions },
      )
    }

    return buildDecision(
      'OVERDUE',
      'Overdue',
      'HIGH',
      `The planned completion date (${formatDate(project.end_date_planned)}) has passed while progress remains at ${actualProgress}%.`,
      'Require immediate Engineering monitoring and a corrective action/completion schedule assessment.',
      RESPONSIBLE.ENGINEERING_MPDC,
      inputs,
      { supportingConditions },
    )
  }

  // 3. Not yet overdue, but tracking behind the expected schedule.
  if (isBehindSchedule) {
    return buildDecision(
      'BEHIND_SCHEDULE',
      'Behind Schedule',
      variance >= HIGH_VARIANCE_PCT ? 'HIGH' : 'MEDIUM',
      `Actual progress (${actualProgress}%) is ${variance.toFixed(0)} percentage points below the expected progress (${expectedProgress.toFixed(0)}%) for this point in the schedule.`,
      'Increase monitoring frequency and report the cause of the delay.',
      RESPONSIBLE.ENGINEERING_ONLY,
      inputs,
      { supportingConditions },
    )
  }

  // 4. On schedule, but nobody has reported in a while.
  if (isStale) {
    return buildDecision(
      'MONITORING_REQUIRED',
      'Monitoring Required',
      'MEDIUM',
      `No monitoring update has been submitted in ${daysSinceLastUpdate} days (threshold: ${STALE_AFTER_DAYS} days).`,
      'Engineering site monitoring update required.',
      RESPONSIBLE.ENGINEERING_ONLY,
      inputs,
      { supportingConditions },
    )
  }

  // 5. None of the above — the explicit "healthy" state, not silence.
  return buildDecision(
    'ON_TRACK',
    'On Track',
    'LOW',
    latestUpdate
      ? `Progress (${actualProgress}%) is within the expected range for the current schedule, and monitoring is current.`
      : 'Project is within its planned schedule.',
    'Continue implementation and routine monitoring.',
    RESPONSIBLE.ENGINEERING_ONLY,
    inputs,
  )
}

// Standalone label lookup for callers that only have the persisted
// projects.dss_decision code (list/dashboard pages reading the cached
// column) rather than a full evaluateProjectDss() result.
export const DSS_DECISION_LABELS = {
  ON_TRACK: 'On Track',
  MONITORING_REQUIRED: 'Monitoring Required',
  BEHIND_SCHEDULE: 'Behind Schedule',
  OVERDUE: 'Overdue',
  CRITICAL_DELAY: 'Critical Delay',
  COMPLETION_READY: 'Completion Ready',
  COMPLETED: 'Completed',
}

export function getDssSeverityTone(severity) {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return 'red'
    case 'MEDIUM':
      return 'amber'
    case 'LOW':
      return 'green'
    default:
      return 'neutral'
  }
}
