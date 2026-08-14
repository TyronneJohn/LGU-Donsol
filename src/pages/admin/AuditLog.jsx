import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatDateTime } from '../../utils/format'
import { ROLE_LABELS } from '../../utils/roles'
import { AUDIT_ACTION_LABELS, AUDIT_ACTION_TONES, ENTITY_TYPE_LABELS } from '../../utils/auditLog'

const PAGE_SIZE = 30

const selectClass =
  'rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

// Reads the append-only audit_logs table (admin-only per RLS) that's
// already populated by triggers across every office's mutations — project
// lifecycle, procurement, monitoring, document/image uploads. This page is
// purely a read/filter surface over it, no writes.
export default function AuditLog() {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [entityFilter, setEntityFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  function buildQuery(offset) {
    let query = supabase
      .from('audit_logs')
      .select('id, action, entity_type, entity_id, description, created_at, actor:profiles!audit_logs_actor_id_fkey(full_name, role)')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (entityFilter) query = query.eq('entity_type', entityFilter)
    if (actionFilter) query = query.eq('action', actionFilter)
    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00`)
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59`)

    return query
  }

  async function loadFirstPage() {
    setLoading(true)
    const { data, error } = await buildQuery(0)

    if (error) {
      toast.error('Could not load audit log', error.message)
      setLoading(false)
      return
    }

    const page = data ?? []
    setRows(page)
    setHasMore(page.length === PAGE_SIZE)
    setLoading(false)
  }

  async function loadMore() {
    setLoadingMore(true)
    const { data, error } = await buildQuery(rows.length)

    if (error) {
      toast.error('Could not load more entries', error.message)
      setLoadingMore(false)
      return
    }

    const page = data ?? []
    setRows((current) => [...current, ...page])
    setHasMore(page.length === PAGE_SIZE)
    setLoadingMore(false)
  }

  useEffect(() => {
    loadFirstPage()
  }, [entityFilter, actionFilter, dateFrom, dateTo])

  return (
    <div>
      <PageHeader
        title="Audit Log"
        description="Read-only history of actions across every office — projects, procurement, monitoring, and uploads."
        breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Audit Log' }]}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className={selectClass}>
          <option value="">All entities</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className={selectClass}>
          <option value="">All actions</option>
          {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className={selectClass}
          aria-label="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className={selectClass}
          aria-label="To date"
        />
      </div>

      {loading ? (
        <LoadingState label="Loading audit log..." />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit entries found"
          description="No action matches these filters yet."
        />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Timestamp</th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Entity</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatDateTime(row.created_at)}</td>
                    <td className="px-4 py-2.5 text-slate-800">
                      {row.actor?.full_name ?? 'Unknown user'}
                      {row.actor?.role ? (
                        <span className="ml-1.5 text-xs text-slate-400">
                          ({ROLE_LABELS[row.actor.role] ?? row.actor.role})
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={AUDIT_ACTION_TONES[row.action] ?? 'neutral'}>
                        {AUDIT_ACTION_LABELS[row.action] ?? row.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {ENTITY_TYPE_LABELS[row.entity_type] ?? row.entity_type}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
