import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, FolderKanban, HardHat, PhilippinePeso } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { formatCurrency } from '@shared/utils/format'
import { LoadingState } from '@shared/components/ui/LoadingState'

const TILE_TONES = {
  blue: 'bg-blue-50 text-blue-600 ring-blue-100',
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  gold: 'bg-gold-50 text-gold-600 ring-gold-100',
}

export default function PublicHome() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProjects() {
      const { data, error } = await supabase
        .from('public_projects_view')
        .select('id, status, approved_budget, estimated_cost')

      if (!error) setProjects(data ?? [])
      setLoading(false)
    }
    loadProjects()
  }, [])

  const totalBudget = projects.reduce((sum, p) => sum + Number(p.approved_budget ?? p.estimated_cost ?? 0), 0)
  const ongoingCount = projects.filter((p) => ['FOR_IMPLEMENTATION', 'ONGOING'].includes(p.status)).length
  const completedCount = projects.filter((p) => p.status === 'COMPLETED').length

  const stats = [
    { icon: FolderKanban, label: 'Published Projects', value: projects.length, tone: 'blue' },
    { icon: HardHat, label: 'Ongoing', value: ongoingCount, tone: 'gold' },
    { icon: CheckCircle2, label: 'Completed', value: completedCount, tone: 'emerald' },
    { icon: PhilippinePeso, label: 'Total Budget', value: formatCurrency(totalBudget), tone: 'blue' },
  ]

  return (
    <div>
      <section className="border-b border-slate-200 bg-linear-to-b from-blue-50/60 to-transparent">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold text-slate-800 sm:text-3xl">
            LGU Donsol Project Monitoring
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500 sm:text-base">
            Track the status of approved local government infrastructure and development
            projects. Public information shown here reflects only projects that have been
            reviewed and published by MPDC.
          </p>
          <Link
            to="/projects"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-linear-to-r from-blue-700 to-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-700/30 transition-all hover:from-blue-800 hover:to-blue-700"
          >
            View Published Projects
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        {loading ? (
          <LoadingState label="Loading project statistics..." />
        ) : projects.length === 0 ? (
          <p className="text-center text-sm text-slate-400">
            Public project listings will appear here once the monitoring system is populated.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center gap-4 rounded-xl border border-slate-200/70 bg-white p-5 shadow-sm shadow-slate-200/60 transition-shadow hover:shadow-md"
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${TILE_TONES[stat.tone]}`}
                >
                  <stat.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-slate-800">{stat.value}</p>
                  <p className="text-xs text-slate-500">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
