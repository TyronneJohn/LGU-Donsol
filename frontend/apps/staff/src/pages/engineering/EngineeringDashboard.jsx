import { useEffect, useState } from 'react'
import { AlertTriangle, HardHat, RotateCcw } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useAuth } from '../../hooks/useAuth'
import { useAnnualBudget } from '../../hooks/useAnnualBudget'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import StatTile from '../../components/ui/StatTile'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'
import { formatCurrency } from '@shared/utils/format'
import { SITE_MONITORING_VISIBLE_STATUSES } from '@shared/utils/projectStatus'

// Pending Review is system-wide (mirrors ProjectReview.jsx, which reviews
// submissions regardless of implementing office); the implementation-stage
// tiles are scoped to the viewer's own office (mirrors SiteMonitoring.jsx).
// Each links to exactly the page/filter that shows the set it counts.
const STAT_TILES = [
  { key: 'pendingReview', label: 'Pending Review', to: '/engineering/review' },
  { key: 'implementation', label: 'For Implementation', to: '/engineering/monitoring?status=FOR_IMPLEMENTATION' },
  { key: 'ongoing', label: 'Ongoing', to: '/engineering/monitoring?status=ONGOING' },
  { key: 'completed', label: 'Completed', to: '/engineering/monitoring?status=COMPLETED' },
]

export default function EngineeringDashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [counts, setCounts] = useState(null)
  const [statusTally, setStatusTally] = useState({})
  const budget = useAnnualBudget()

  async function loadSummary() {
    setLoading(true)
    setLoadError(null)

    try {
      const { count: pendingReview, error: reviewError } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'SUBMITTED_FOR_REVIEW')
      if (reviewError) throw reviewError

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('office_id')
        .eq('id', user.id)
        .maybeSingle()
      if (profileError) throw profileError

      let officeProjects = []
      if (profile?.office_id) {
        const { data: rows, error: officeError } = await supabase
          .from('projects')
          .select('id, status')
          .eq('office_id', profile.office_id)
          .in('status', SITE_MONITORING_VISIBLE_STATUSES)
        if (officeError) throw officeError
        officeProjects = rows ?? []
      }

      const byStatus = (status) => officeProjects.filter((p) => p.status === status).length

      const tally = {}
      for (const project of officeProjects) tally[project.status] = (tally[project.status] ?? 0) + 1
      setStatusTally(tally)

      setCounts({
        pendingReview: pendingReview ?? 0,
        implementation: byStatus('FOR_IMPLEMENTATION'),
        ongoing: byStatus('ONGOING'),
        completed: byStatus('COMPLETED'),
      })
    } catch (error) {
      setLoadError(error.message || 'Something went wrong while loading the dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
  }, [])

  const total = counts ? counts.pendingReview + counts.implementation + counts.ongoing + counts.completed : 0

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Projects assigned to your office for implementation and site monitoring."
      />

      {loading ? (
        <LoadingState label="Loading dashboard..." />
      ) : loadError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Unable to load dashboard"
          description={loadError}
          action={
            <Button variant="secondary" size="sm" icon={RotateCcw} onClick={loadSummary}>
              Retry
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No projects assigned yet"
          description="Projects MPDC assigns to your office for implementation will appear here."
        />
      ) : (
        <>
          <div className="mb-3">
            <StatTile
              label={`Remaining Budget — ${budget.year}`}
              value={budget.loading ? '—' : budget.ceiling != null ? formatCurrency(budget.remaining) : 'Not set'}
              featured
            />
          </div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {STAT_TILES.map((tile) => (
              <StatTile key={tile.key} label={tile.label} value={counts[tile.key]} to={tile.to} />
            ))}
          </div>
          <ProjectStatusCharts counts={statusTally} title="Your Office — Projects by Status" />
        </>
      )}
    </div>
  )
}
