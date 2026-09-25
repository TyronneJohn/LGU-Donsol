import { useEffect, useState } from 'react'
import { ArrowRight, ClipboardCheck } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { formatCurrency, formatDate } from '@shared/utils/format'

export default function ProjectReview() {
  const toast = useToast()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  async function loadProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, project_category, barangay, estimated_cost, created_at,
         offices(name),
         creator:profiles!projects_created_by_fkey(full_name)`,
      )
      .eq('status', 'SUBMITTED_FOR_REVIEW')
      .order('created_at', { ascending: true })

    if (error) {
      toast.error('Could not load projects for review', error.message)
    } else {
      setProjects(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadProjects()
  }, [])

  return (
    <div>
      <PageHeader
        title="Projects for Review"
        description="Projects submitted by MPDC for review, awaiting a decision."
        breadcrumbs={[{ label: 'Dashboard', to: '/engineering' }, { label: 'Project Review' }]}
      />

      {loading ? (
        <LoadingState label="Loading projects..." />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nothing to review"
          description="Projects submitted for review will show up here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Project Code</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Submitted By</th>
                <th className="px-4 py-2.5 font-medium">Est. Cost</th>
                <th className="px-4 py-2.5 font-medium">Submitted</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.map((project) => (
                <tr key={project.id}>
                  <td className="px-4 py-2.5 text-slate-800">{project.project_code}</td>
                  <td className="px-4 py-2.5 text-slate-800">{project.title}</td>
                  <td className="px-4 py-2.5 text-slate-600">{project.offices?.name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{project.creator?.full_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatCurrency(project.estimated_cost)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatDate(project.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button to={`/engineering/review/${project.id}`} variant="secondary" size="sm" icon={ArrowRight}>
                      Review
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
