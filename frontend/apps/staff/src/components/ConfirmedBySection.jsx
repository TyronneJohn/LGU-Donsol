import { useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { formatDateTime } from '@shared/utils/format'
import { useToast } from '../hooks/useToast'
import { CONFIRMED_BY_INPUT_ID } from '../hooks/useConfirmedBy'
import { ROLE_LABELS } from '../utils/roles'
import FieldError from './ui/FieldError'
import { invalidClass } from '../utils/fieldStyles'

const inputClass =
  'w-full rounded-md border border-slate-400 dark:border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

// "Confirmed By" section at the bottom of a project page: the real names of
// the staff who worked on the project (office accounts are shared, so the
// account alone doesn't say who did it).
//
// - `confirmedBy` (from useConfirmedBy) shows the name input that every
//   action on the page requires. Leave it out on read-only pages.
// - `projectId` loads the history of names already recorded; null for a
//   project that hasn't been saved yet.
// - `showHistory` shows the table of recorded names. Only the Admin can read
//   it (RLS); office pages pass false and keep just the name input.
export default function ConfirmedBySection({ projectId, confirmedBy, refreshKey, showHistory = true }) {
  const toast = useToast()
  const [entries, setEntries] = useState(null)

  useEffect(() => {
    if (!showHistory || !projectId) {
      setEntries([])
      return undefined
    }
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('project_confirmations')
        .select('id, action, confirmed_by_name, account_role, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) toast.error('Could not load Confirmed By history', error.message)
      setEntries(data ?? [])
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId, refreshKey, showHistory])

  if (!showHistory && !confirmedBy) return null

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
      <div className="flex items-center gap-2">
        <UserCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-slate-800">Confirmed By</h2>
      </div>
      <p className="mt-0.5 text-xs text-slate-400">
        {showHistory
          ? 'The staff who worked on this project. Office accounts are shared, so each save, submission or update records the real name of the person who did it.'
          : 'Office accounts are shared, so your name is recorded with each save, submission or update. Only the Admin can see this record.'}
      </p>

      {confirmedBy ? (
        <div className="mt-4 max-w-md">
          <label htmlFor={CONFIRMED_BY_INPUT_ID} className="mb-1 block text-sm font-medium text-slate-700">
            Your Full Name *
          </label>
          <input
            id={CONFIRMED_BY_INPUT_ID}
            value={confirmedBy.name}
            onChange={(event) => confirmedBy.setName(event.target.value)}
            placeholder="e.g. Juan Dela Cruz"
            autoComplete="name"
            className={inputClass + invalidClass(confirmedBy.error)}
          />
          <FieldError message={confirmedBy.error} />
          {!confirmedBy.error ? (
            <p className="mt-1 text-xs text-slate-400">
              Required before saving, submitting or updating anything on this page.
            </p>
          ) : null}
        </div>
      ) : null}

      {!showHistory ? null : entries === null ? (
        <p className="mt-4 text-sm text-slate-500">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No confirmed actions recorded yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border border-slate-100">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{entry.confirmed_by_name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{entry.action}</td>
                  <td className="px-4 py-2.5 text-slate-600">{ROLE_LABELS[entry.account_role] ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
