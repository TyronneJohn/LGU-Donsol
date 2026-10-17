import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { PiggyBank, X } from 'lucide-react'
import Badge from '@shared/components/ui/Badge'
import { formatCurrency } from '@shared/utils/format'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '@shared/utils/projectStatus'
import { useProjectSavings, summarizeSavings } from '../hooks/useProjectSavings'

// "Savings" card on the MPDC and Admin dashboards only. Shows the current
// year's confirmed savings (allocation − contract amount) plus what is still
// projected from projects awaiting bidding (allocation − POW); clicking it
// opens the per-project breakdown with a year filter.
//
// `projectLink(id)` is the route of a project's detail page for the role.
export default function SavingsTile({ projectLink }) {
  const savings = useProjectSavings()
  const [open, setOpen] = useState(false)
  const currentYear = new Date().getFullYear()
  const summary = summarizeSavings(savings.rows, currentYear)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-xl border border-slate-200/70 bg-white p-5 text-left shadow-sm shadow-slate-200/60 transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <p className="text-sm font-medium uppercase tracking-wide text-slate-400">Savings — {currentYear}</p>
        <p className="mt-1 text-3xl font-semibold text-emerald-700">
          {savings.loading ? '—' : savings.error ? 'Unavailable' : formatCurrency(summary.confirmedTotal)}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {savings.loading
            ? 'Loading...'
            : savings.error
              ? savings.error
              : `From ${summary.confirmedCount} awarded ${summary.confirmedCount === 1 ? 'project' : 'projects'}` +
                (summary.projectedCount > 0
                  ? ` · + ${formatCurrency(summary.projectedTotal)} projected from ${summary.projectedCount} awaiting bidding`
                  : '') +
                ' · View breakdown'}
        </p>
      </button>

      {open ? (
        <SavingsModal
          rows={savings.rows}
          currentYear={currentYear}
          projectLink={projectLink}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function SavingsModal({ rows, currentYear, projectLink, onClose }) {
  const [year, setYear] = useState(currentYear)
  const summary = summarizeSavings(rows, year)
  const years = [...new Set([currentYear, ...rows.map((row) => row.year)])].sort((a, b) => b - a)

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onClose}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="savings-modal-title"
        className="animate-pop-in relative flex max-h-full w-full max-w-4xl flex-col rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="savings-modal-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <PiggyBank className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Project Savings
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Confirmed = Allocation − Contract Amount (winning bid). Projected = Allocation − POW, for projects
              not yet awarded; it can only grow once bidding is done.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="savings_year" className="mb-1 block text-xs font-medium text-slate-600">
              Year
            </label>
            <select
              id="savings_year"
              value={year}
              onChange={(event) => setYear(event.target.value === 'all' ? 'all' : Number(event.target.value))}
              className="rounded-md border border-slate-400 dark:border-slate-300 px-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
            >
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value="all">All years</option>
            </select>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Confirmed</p>
            <p className="text-lg font-semibold text-emerald-700">{formatCurrency(summary.confirmedTotal)}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Projected</p>
            <p className="text-lg font-semibold text-slate-600">{formatCurrency(summary.projectedTotal)}</p>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-md border border-slate-100">
          {summary.rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No endorsed projects with a POW or contract amount for this year.
            </p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Project</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Allocation</th>
                  <th className="px-3 py-2.5 text-right font-medium">POW (ABC)</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contract</th>
                  <th className="px-3 py-2.5 text-right font-medium">Savings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2.5">
                      <Link to={projectLink(row.id)} className="font-medium text-blue-700 hover:underline">
                        {row.projectCode}
                      </Link>
                      <p className="max-w-xs truncate text-xs text-slate-500">{row.title}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={PROJECT_STATUS_TONES[row.status]}>{PROJECT_STATUS_LABELS[row.status]}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{formatCurrency(row.allocation)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{formatCurrency(row.powAmount)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{formatCurrency(row.contractAmount)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={`font-semibold ${
                          row.savings < 0 ? 'text-red-600' : row.kind === 'confirmed' ? 'text-emerald-700' : 'text-slate-600'
                        }`}
                      >
                        {formatCurrency(row.savings)}
                      </span>
                      <p className="text-xs text-slate-400">{row.kind === 'confirmed' ? 'Confirmed' : 'Projected'}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
