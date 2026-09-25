import { Inbox } from 'lucide-react'

// `bordered` controls the dashed-card look used for full-panel empty states
// (e.g. a dashboard section) vs. the bare look used inside something that
// already has its own container (e.g. the notifications dropdown).
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  bordered = true,
  className = '',
}) {
  const wrapper = bordered
    ? 'rounded-xl border border-dashed border-slate-300 bg-white/70 px-6 py-10 shadow-sm shadow-slate-200/50'
    : 'py-4'

  return (
    <div className={`flex flex-col items-center gap-2 text-center ${wrapper} ${className}`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 ring-1 ring-inset ring-blue-100">
        <Icon className="h-6 w-6 text-blue-400" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
