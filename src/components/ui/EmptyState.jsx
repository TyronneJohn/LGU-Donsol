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
    ? 'rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10'
    : 'py-4'

  return (
    <div className={`flex flex-col items-center gap-2 text-center ${wrapper} ${className}`}>
      <Icon className="h-8 w-8 text-slate-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
