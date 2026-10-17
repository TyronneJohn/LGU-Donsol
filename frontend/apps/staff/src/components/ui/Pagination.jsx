import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_SIZE } from '../../hooks/usePagination'

function pageList(page, totalPages) {
  const pages = []
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
      pages.push(p)
    } else if (pages.at(-1) !== '…') {
      pages.push('…')
    }
  }
  return pages
}

const baseButton =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-50'
const idleButton = 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:bg-slate-50'
export default function Pagination({ page, totalPages, totalItems, setPage }) {
  if (totalItems === 0) return null

  const first = (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, totalItems)

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-slate-500">
        Showing {first}–{last} of {totalItems} {totalItems === 1 ? 'project' : 'projects'}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs text-slate-500">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage(page - 1)}
          disabled={page === 1}
          className={`${baseButton} ${idleButton}`}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {pageList(page, totalPages).map((p, index) =>
          p === '…' ? (
            <span key={`gap-${index}`} className="px-1 text-xs text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`${baseButton} ${p === page ? 'border-blue-600 bg-blue-600 text-white' : idleButton}`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={() => setPage(page + 1)}
          disabled={page === totalPages}
          className={`${baseButton} ${idleButton}`}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  )
}
