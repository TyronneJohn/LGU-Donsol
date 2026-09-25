import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

// Shared dashboard stat card. Renders as a Link (clickable, hover/focus
// affordance) when `to` is given, or a plain card when it isn't — used for
// tiles whose count doesn't correspond to any single existing list view.
export default function StatTile({ label, value, to, warn, featured }) {
  const valueClass = `mt-1 flex items-center gap-1.5 font-semibold ${warn ? 'text-amber-600' : 'text-slate-800'} ${
    featured ? 'text-3xl' : 'text-2xl'
  }`
  const labelClass = `font-medium uppercase tracking-wide text-slate-400 ${featured ? 'text-sm' : 'text-xs'}`
  const content = (
    <>
      <p className={labelClass}>{label}</p>
      <p className={valueClass}>
        {warn ? <AlertTriangle className="h-5 w-5" aria-hidden="true" /> : null}
        {value}
      </p>
    </>
  )

  const baseClass = `block w-full col-span-2 rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 transition-colors ${
    featured ? 'p-5' : 'p-4'
  }`
  const wrapperClass = featured ? baseClass : baseClass.replace('col-span-2 ', '')

  if (to) {
    return (
      <Link
        to={to}
        className={`${wrapperClass} hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2`}
      >
        {content}
      </Link>
    )
  }

  return <div className={wrapperClass}>{content}</div>
}
