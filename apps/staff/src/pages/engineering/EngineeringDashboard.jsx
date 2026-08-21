import { useEffect, useState } from 'react'
import { HardHat } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'

export default function EngineeringDashboard() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState({})
  const [total, setTotal] = useState(0)

  useEffect(() => {
    async function loadStatusCounts() {
      setLoading(true)

      const { data, error } = await supabase.from('projects').select('status')

      if (error) {
        toast.error('Could not load dashboard data', error.message)
        setLoading(false)
        return
      }

      const rows = data ?? []
      const tally = {}
      for (const row of rows) tally[row.status] = (tally[row.status] ?? 0) + 1

      setCounts(tally)
      setTotal(rows.length)
      setLoading(false)
    }

    loadStatusCounts()
  }, [])

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Projects assigned to your office for implementation and site monitoring."
      />

      {loading ? (
        <LoadingState label="Loading dashboard..." />
      ) : total === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No projects assigned yet"
          description="Projects MPDC assigns to your office for implementation will appear here."
        />
      ) : (
        <ProjectStatusCharts counts={counts} />
      )}
    </div>
  )
}
