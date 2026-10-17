import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'
import { MONITORING_VISIBLE_STATUSES } from '@shared/utils/projectStatus'

// Savings per project for the MPDC and Admin dashboards (SavingsTile).
// Only projects from Endorsed to BAC onward count, same as the Annual
// Budget's "committed" figure (useAnnualBudget).
//
// - Confirmed: BAC has a contract amount (the winning bid) on the current
//   procurement → allocation (approved_budget) minus contract amount.
// - Projected: no contract yet → allocation minus the POW (the ABC, which
//   caps every bid), so the final savings can only grow from here.
//
// Projects have no budget-year column, so a project's year is the year of
// its Proposed Start Date, falling back to when it was created.
export function useProjectSavings() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: queryError } = await supabase
        .from('projects')
        .select(
          `id, project_code, title, status, approved_budget, pow_amount, start_date_planned, created_at,
           procurement(contract_amount, is_current)`,
        )
        .in('status', MONITORING_VISIBLE_STATUSES)
        .order('project_code', { ascending: true })
      if (queryError) throw queryError

      const savingsRows = []
      for (const project of data ?? []) {
        if (project.approved_budget == null) continue
        const allocation = Number(project.approved_budget)
        const contractAmount = (project.procurement ?? []).find((entry) => entry.is_current)?.contract_amount
        const powAmount = project.pow_amount != null ? Number(project.pow_amount) : null

        let kind = null
        let savings = null
        if (contractAmount != null) {
          kind = 'confirmed'
          savings = allocation - Number(contractAmount)
        } else if (powAmount != null) {
          kind = 'projected'
          savings = allocation - powAmount
        }
        if (kind == null) continue

        savingsRows.push({
          id: project.id,
          projectCode: project.project_code,
          title: project.title,
          status: project.status,
          year: new Date(project.start_date_planned ?? project.created_at).getFullYear(),
          allocation,
          powAmount,
          contractAmount: contractAmount != null ? Number(contractAmount) : null,
          kind,
          savings,
        })
      }
      setRows(savingsRows)
    } catch (err) {
      setError(err.message || 'Could not load project savings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { rows, loading, error, refresh: load }
}

// Totals for the rows of one year (or every year when `year` is 'all').
export function summarizeSavings(rows, year) {
  const scoped = year === 'all' ? rows : rows.filter((row) => row.year === year)
  const confirmed = scoped.filter((row) => row.kind === 'confirmed')
  const projected = scoped.filter((row) => row.kind === 'projected')
  const sum = (list) => list.reduce((total, row) => total + row.savings, 0)
  return {
    rows: scoped,
    confirmedTotal: sum(confirmed),
    confirmedCount: confirmed.length,
    projectedTotal: sum(projected),
    projectedCount: projected.length,
  }
}
