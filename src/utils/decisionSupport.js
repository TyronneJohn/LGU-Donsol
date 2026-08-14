// Rule-based decision-support flags for a project under implementation.
// Pure functions over data already loaded by the page — no ML, just the
// schedule-variance/staleness math a human reviewer would otherwise have to
// do by hand when scanning a project list.

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
