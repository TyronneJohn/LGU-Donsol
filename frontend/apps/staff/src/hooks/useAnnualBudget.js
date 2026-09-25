import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@shared/lib/supabaseClient'
import { MONITORING_VISIBLE_STATUSES } from '@shared/utils/projectStatus'
import { useAuth } from './useAuth'

// System-wide "Remaining Budget" shown on every staff dashboard: the
// Annual Budget ceiling Admin sets for the current year (see
// annual_budgets, 20260902120000_annual_budget.sql), minus the sum of
// approved_budget/estimated_cost across every project from APPROVED
// onward (MONITORING_VISIBLE_STATUSES). Pre-approval projects (DRAFT/
// SUBMITTED_FOR_REVIEW/RETURNED_FOR_REVISION/REJECTED) aren't yet an
// appropriated obligation, so they don't draw against the ceiling.
export function useAnnualBudget() {
  const { user } = useAuth()
  const year = new Date().getFullYear()
  const [ceiling, setCeiling] = useState(null)
  const [committed, setCommitted] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [budgetResult, projectsResult] = await Promise.all([
        supabase.from('annual_budgets').select('amount').eq('year', year).maybeSingle(),
        supabase.from('projects').select('estimated_cost, approved_budget').in('status', MONITORING_VISIBLE_STATUSES),
      ])
      if (budgetResult.error) throw budgetResult.error
      if (projectsResult.error) throw projectsResult.error

      setCeiling(budgetResult.data ? Number(budgetResult.data.amount) : null)
      setCommitted(
        (projectsResult.data ?? []).reduce((sum, p) => sum + Number(p.approved_budget ?? p.estimated_cost ?? 0), 0),
      )
    } catch (err) {
      setError(err.message || 'Could not load the annual budget.')
    } finally {
      setLoading(false)
    }
  }, [year])

  useEffect(() => {
    load()
  }, [load])

  async function save(amount) {
    const { error: upsertError } = await supabase
      .from('annual_budgets')
      .upsert({ year, amount, updated_by: user.id }, { onConflict: 'year' })
    if (upsertError) throw upsertError
    await load()
  }

  return {
    year,
    ceiling,
    committed,
    remaining: ceiling != null ? ceiling - committed : null,
    loading,
    error,
    refresh: load,
    save,
  }
}
