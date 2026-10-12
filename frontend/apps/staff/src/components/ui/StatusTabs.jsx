import { PROJECT_STATUS_LABELS } from '@shared/utils/projectStatus'

// Splits a project list by status: an "All" tab plus one tab per status
// that actually has projects (in workflow order), each with its count.
// `value` is the selected status ('' for All).
export default function StatusTabs({ projects, value, onChange }) {
  const counts = {}
  for (const project of projects) {
    counts[project.status] = (counts[project.status] ?? 0) + 1
  }
  const statuses = Object.keys(PROJECT_STATUS_LABELS).filter((status) => counts[status] || status === value)

  const tabs = [{ key: '', label: 'All', count: projects.length }].concat(
    statuses.map((status) => ({ key: status, label: PROJECT_STATUS_LABELS[status], count: counts[status] ?? 0 })),
  )

  return (
    <div role="tablist" aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const active = tab.key === value
        return (
          <button
            key={tab.key || 'ALL'}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              active
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
            }`}
          >
            {tab.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
                active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {tab.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
