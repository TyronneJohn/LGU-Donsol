import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

export const PAGE_SIZE = 15

// Client-side pagination for an already-loaded list. The current page lives
// in the URL (?page=N) so going Back from a project's detail page returns
// to the same page. Any change in `resetDeps` (search text, a filter) jumps
// back to page 1, since the old page number no longer means anything.
export function usePagination(items, resetDeps = []) {
  const [searchParams, setSearchParams] = useSearchParams()
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const requested = Number.parseInt(searchParams.get('page') ?? '1', 10)
  const page = Math.min(Math.max(Number.isNaN(requested) ? 1 : requested, 1), totalPages)

  function setPage(next) {
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        if (next > 1) params.set('page', String(next))
        else params.delete('page')
        return params
      },
      { replace: true },
    )
  }

  // Compared against the previous value rather than skipping the first
  // effect run, so React StrictMode's double-invoked mount effect can't
  // wipe a ?page= that was in the URL on arrival.
  const resetKey = JSON.stringify(resetDeps)
  const previousResetKey = useRef(resetKey)
  useEffect(() => {
    if (previousResetKey.current === resetKey) return
    previousResetKey.current = resetKey
    setPage(1)
  }, [resetKey])

  const start = (page - 1) * PAGE_SIZE
  return {
    page,
    totalPages,
    setPage,
    totalItems: items.length,
    pageItems: items.slice(start, start + PAGE_SIZE),
  }
}
