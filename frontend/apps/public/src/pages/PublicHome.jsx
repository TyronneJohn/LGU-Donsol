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
      <section>
        <div className="animate-fade-in mx-auto max-w-6xl px-4 pb-14 pt-20 text-center sm:pb-16 sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-gold-200 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-gold-400" aria-hidden="true" />
            Bayan ng Donsol, Sorsogon
          </span>
          <h1 className="mt-5 font-display text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            LGU Donsol Project Monitoring
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-blue-100/85 sm:text-base">
            Track the status of approved local government infrastructure and development
            projects. Public information shown here reflects only projects that have been
            reviewed and published by MPDC.
          </p>
          <Link
            to="/projects"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-gold-400 px-5 py-2.5 text-sm font-semibold text-blue-950 shadow-lg shadow-gold-500/25 transition-all hover:bg-gold-300 hover:shadow-gold-400/40"
          >
            View Published Projects
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        {loading ? (
          <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm">
            <LoadingState label="Loading project statistics..." />
          </div>
        ) : projects.length === 0 ? (
          <p className="rounded-xl border border-slate-200/70 bg-white p-6 text-center text-sm text-slate-400 shadow-sm">
            Public project listings will appear here once the monitoring system is populated.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center gap-4 rounded-xl border border-slate-200/70 bg-white p-5 shadow-lg shadow-blue-950/10 transition-all hover:-translate-y-0.5 hover:shadow-xl"
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
