import { useEffect, useState } from 'react'
import { FolderKanban } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { ProjectStatusCharts } from '../../components/ui/ProjectStatusCharts'

export default function AdminDashboard() {
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
      <PageHeader title="Dashboard" description="System-wide overview across all offices." />

      {loading ? (
        <LoadingState label="Loading dashboard..." />
      ) : total === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No dashboard data yet"
          description="Once projects, submissions, and procurement activity start flowing through the system, an overview will appear here."
        />
      ) : (
        <ProjectStatusCharts counts={counts} title="Projects by Status — All Offices" />
      )}
    </div>
  )
}
