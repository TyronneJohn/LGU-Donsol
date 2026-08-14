import { getMonitoringFlags } from './decisionSupport'

// Shared data loader for every role's Geo Mapping page. Fetches the same
// project + progress + procurement/contractor join every role's map needs,
// once, in one place — the four per-role pages only differ in which of
// these projects are *relevant* to show and where "View Project" should
// link, not in how the data is fetched. Reuses the same
// projects_select_staff RLS access every other staff page already relies
// on; no new query shape, no new table.
export async function loadGeoProjects(supabase) {
  const { data: projectRows, error: projectsError } = await supabase
    .from('projects')
    .select(
      `id, project_code, title, description, project_category, barangay, location_text,
       latitude, longitude, estimated_cost, approved_budget, funding_source,
       start_date_planned, end_date_planned, start_date_actual, end_date_actual,
       status, office_id, created_by, created_at,
       offices(name)`,
    )
    .order('created_at', { ascending: false })

  if (projectsError) throw projectsError

  const rows = projectRows ?? []
  if (rows.length === 0) {
    return { projects: [], warnings: [] }
  }

  const ids = rows.map((p) => p.id)

  const [updatesResult, procurementResult] = await Promise.all([
    supabase
      .from('project_updates')
      .select('project_id, progress_percentage, report_date')
      .in('project_id', ids)
      .order('report_date', { ascending: false }),
    supabase
      .from('procurement')
      .select('project_id, status, contractors(name)')
      .in('project_id', ids)
      .eq('is_current', true),
  ])

  const updatesByProject = new Map()
  for (const update of updatesResult.data ?? []) {
    if (!updatesByProject.has(update.project_id)) updatesByProject.set(update.project_id, [])
    updatesByProject.get(update.project_id).push(update)
  }
  const procurementByProject = new Map((procurementResult.data ?? []).map((p) => [p.project_id, p]))

  const projects = rows.map((project) => {
    const updates = updatesByProject.get(project.id) ?? []
    const latestUpdate = updates[0] ?? null
    const procurement = procurementByProject.get(project.id)
    return {
      ...project,
      progress_percentage: latestUpdate?.progress_percentage ?? null,
      latest_monitoring_date: latestUpdate?.report_date ?? null,
      procurement_status: procurement?.status ?? null,
      contractor_name: procurement?.contractors?.name ?? null,
      // Same getMonitoringFlags() every other DSS caller uses — computed
      // once here so every role's map shows identical flags for the same
      // project, never a per-role recalculation.
      flags: getMonitoringFlags(project, updates),
    }
  })

  const warnings = [updatesResult.error, procurementResult.error].filter(Boolean)
  return { projects, warnings }
}
