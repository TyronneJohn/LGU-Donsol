import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import { ROLE_LABELS } from '../../utils/roles'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

const EMPTY_FORM = { email: '', password: '', office_id: '' }

// AuthContext's presence heartbeat (apps/staff/src/contexts/AuthContext.jsx)
// upserts a profile_sessions row per open tab/device every 60s, and deletes
// only that row on sign-out — so an account with one session signed out and
// another still open correctly keeps showing Active. A few missed beats'
// worth of slack absorbs normal network jitter without a merely-slow tab
// reading as offline.
const HEARTBEAT_INTERVAL_MS = 60_000
const ONLINE_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * 3
const REFRESH_INTERVAL_MS = 30_000

// Account creation itself happens in the create-staff-account Edge
// Function (supabase/functions/create-staff-account) — it needs the
// service role key, which can never live in this client bundle. Role isn't
// collected here: the function derives it from the chosen office (each of
// the three seeded offices maps 1:1 to a login role).
export default function StaffAccounts() {
  const toast = useToast()
  const [staff, setStaff] = useState([])
  const [offices, setOffices] = useState([])
  const [onlineIds, setOnlineIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const firstFieldRef = useRef(null)

  // `silent` skips the loading spinner — used for the background refresh
  // below so the "who's online" status can update without the whole table
  // flashing back to a loading state every 30s.
  async function loadData({ silent = false } = {}) {
    if (!silent) setLoading(true)
    const [staffResult, officesResult, sessionsResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, role, is_active, offices(name)')
        .order('full_name', { ascending: true }),
      supabase.from('offices').select('id, name').order('name', { ascending: true }),
      // Any profile with at least one session row this recent is online —
      // "recent" absorbs one or two missed heartbeats without flapping.
      supabase
        .from('profile_sessions')
        .select('profile_id')
        .gte('last_seen_at', new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString()),
    ])

    if (staffResult.error) {
      if (!silent) toast.error('Could not load staff accounts', staffResult.error.message)
    } else {
      setStaff(staffResult.data ?? [])
    }

    if (officesResult.error) {
      if (!silent) toast.error('Could not load offices', officesResult.error.message)
    } else {
      setOffices(officesResult.data ?? [])
    }

    if (sessionsResult.error) {
      if (!silent) toast.error('Could not load online status', sessionsResult.error.message)
    } else {
      setOnlineIds(new Set((sessionsResult.data ?? []).map((row) => row.profile_id)))
    }

    if (!silent) setLoading(false)
  }

  useEffect(() => {
    loadData()
    // Online status is only as fresh as the last fetch — poll quietly so an
    // admin watching this page sees people go offline without a manual
    // reload.
    const interval = setInterval(() => loadData({ silent: true }), REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!formOpen) return undefined

    firstFieldRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') closeForm()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [formOpen])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function openForm() {
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
  }

  async function handleSubmit(event) {
    event.preventDefault()

    if (form.password.length < 6) {
      toast.error('Password too short', 'Use at least 6 characters.')
      return
    }
    if (!form.office_id) {
      toast.error('Office required', 'Select which office this account belongs to.')
      return
    }

    setSubmitting(true)
    const email = form.email

    const { data, error } = await supabase.functions.invoke('create-staff-account', {
      body: form,
    })

    setSubmitting(false)

    if (error) {
      // supabase-js only sets error.message to a generic "non-2xx status
      // code" string for FunctionsHttpError — the function's actual JSON
      // error body is on error.context (a raw Response) and has to be read
      // separately to show something the admin can act on.
      let message = error.message
      if (error.context?.json) {
        try {
          const body = await error.context.json()
          if (body?.error) message = body.error
        } catch {
          // context wasn't JSON — fall back to the generic message.
        }
      }
      toast.error('Could not create account', message)
      return
    }
    if (data?.error) {
      toast.error('Could not create account', data.error)
      return
    }

    closeForm()
    toast.success('Staff account created', `${email} can now sign in.`)
    loadData()
  }

  return (
    <div>
      <PageHeader
        title="Staff Accounts"
        description="Create logins for Engineering, MPDC, and BAC."
        breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Staff Accounts' }]}
        actions={
          <Button icon={Plus} onClick={openForm}>
            Add Staff Account
          </Button>
        }
      />

      {loading ? (
        <LoadingState label="Loading staff accounts..." />
      ) : staff.length === 0 ? (
        <EmptyState
          title="No staff accounts yet"
          description="Accounts you create for Engineering, MPDC, and BAC will appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Office</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.map((person) => (
                <tr key={person.id}>
                  <td className="px-4 py-2.5 text-slate-800">{person.full_name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {person.role ? (
                      <Badge tone="blue">{ROLE_LABELS[person.role] ?? person.role}</Badge>
                    ) : (
                      <Badge tone="amber">Unassigned</Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{person.offices?.name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    {!person.is_active ? (
                      <Badge tone="red">Disabled</Badge>
                    ) : onlineIds.has(person.id) ? (
                      <Badge tone="green">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
              <button
                type="button"
                aria-label="Dismiss dialog"
                onClick={closeForm}
                className="fixed inset-0 bg-slate-900/50"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-staff-title"
                className="relative w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
              >
                <div className="mb-4 flex items-start justify-between">
                  <h2 id="add-staff-title" className="text-base font-semibold text-slate-800">
                    Add Staff Account
                  </h2>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={closeForm}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                      Email
                    </label>
                    <input
                      ref={firstFieldRef}
                      id="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={(event) => updateField('email', event.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    <input
                      id="password"
                      type="password"
                      required
                      minLength={6}
                      value={form.password}
                      onChange={(event) => updateField('password', event.target.value)}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="office_id" className="mb-1 block text-sm font-medium text-slate-700">
                      Office
                    </label>
                    <select
                      id="office_id"
                      required
                      value={form.office_id}
                      onChange={(event) => updateField('office_id', event.target.value)}
                      className={inputClass}
                    >
                      <option value="">Select an office</option>
                      {offices.map((office) => (
                        <option key={office.id} value={office.id}>
                          {office.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="secondary" size="sm" onClick={closeForm} disabled={submitting}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" loading={submitting}>
                      Create Account
                    </Button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
