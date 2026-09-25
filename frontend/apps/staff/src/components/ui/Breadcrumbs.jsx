import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

// items: [{ label, to }] — the last item is always treated as the current
// page (no link, aria-current="page"), even if it has a `to`.
export default function Breadcrumbs({ items = [] }) {
  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          return (
            <li key={item.label} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              ) : null}
              {isLast || !item.to ? (
                <span
                  className={isLast ? 'font-medium text-slate-700' : undefined}
                  aria-current={isLast ? 'page' : undefined}
                >
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="hover:text-blue-700">
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
