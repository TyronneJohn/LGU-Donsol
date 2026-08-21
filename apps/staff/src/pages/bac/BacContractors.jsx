import { useEffect, useMemo, useState } from 'react'
import { Building2, Pencil, Plus, Search } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

const EMPTY_FORM = {
  name: '',
  business_address: '',
  contact_person: '',
  contact_number: '',
  email: '',
  license_number: '',
}

export default function BacContractors() {
  const toast = useToast()
  const [contractors, setContractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function loadContractors() {
    setLoading(true)
    const { data, error } = await supabase
      .from('contractors')
      .select('id, name, business_address, contact_person, contact_number, email, license_number')
      .order('name', { ascending: true })

    if (error) {
      toast.error('Could not load contractors', error.message)
    } else {
      setContractors(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadContractors()
  }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return contractors
    return contractors.filter(
      (c) => c.name.toLowerCase().includes(term) || c.license_number?.toLowerCase().includes(term),
    )
  }, [contractors, search])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function openAddForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditForm(contractor) {
    setEditingId(contractor.id)
    setForm({
      name: contractor.name ?? '',
      business_address: contractor.business_address ?? '',
      contact_person: contractor.contact_person ?? '',
      contact_number: contractor.contact_number ?? '',
      email: contractor.email ?? '',
      license_number: contractor.license_number ?? '',
    })
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      toast.error('Contractor name is required')
      return
    }

    setSaving(true)
    const payload = {
      name: form.name.trim(),
      business_address: form.business_address.trim() || null,
      contact_person: form.contact_person.trim() || null,
      contact_number: form.contact_number.trim() || null,
      email: form.email.trim() || null,
      license_number: form.license_number.trim() || null,
    }

    const { error } = editingId
      ? await supabase.from('contractors').update(payload).eq('id', editingId)
      : await supabase.from('contractors').insert(payload)

    setSaving(false)

    if (error) {
      toast.error(editingId ? 'Could not update contractor' : 'Could not create contractor', error.message)
      return
    }

    toast.success(editingId ? 'Contractor updated' : 'Contractor created')
    closeForm()
    loadContractors()
  }

  return (
    <div>
      <PageHeader
        title="Contractors"
        description="Master list of contractors used across procurement cycles."
        breadcrumbs={[{ label: 'Dashboard', to: '/bac' }, { label: 'Contractors' }]}
        actions={
          <Button icon={Plus} onClick={() => (formOpen && !editingId ? closeForm() : openAddForm())}>
            {formOpen && !editingId ? 'Cancel' : 'Add Contractor'}
          </Button>
        }
      />

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid gap-4 rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5 sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
              Contractor Name *
            </label>
            <input id="name" required value={form.name} onChange={(e) => updateField('name', e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="business_address" className="mb-1 block text-sm font-medium text-slate-700">
              Business Address
            </label>
            <input
              id="business_address"
              value={form.business_address}
              onChange={(e) => updateField('business_address', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="contact_person" className="mb-1 block text-sm font-medium text-slate-700">
              Contact Person
            </label>
            <input
              id="contact_person"
              value={form.contact_person}
              onChange={(e) => updateField('contact_person', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="contact_number" className="mb-1 block text-sm font-medium text-slate-700">
              Contact Number
            </label>
            <input
              id="contact_number"
              value={form.contact_number}
              onChange={(e) => updateField('contact_number', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="license_number" className="mb-1 block text-sm font-medium text-slate-700">
              License Number
            </label>
            <input
              id="license_number"
              value={form.license_number}
              onChange={(e) => updateField('license_number', e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" loading={saving}>
              {editingId ? 'Save Changes' : 'Create Contractor'}
            </Button>
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-4 max-w-xs">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or license number"
            className={`${inputClass} pl-9`}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading contractors..." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Building2} title="No contractors found" description="Contractors you add will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Contact Person</th>
                <th className="px-4 py-2.5 font-medium">Contact Number</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">License #</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((contractor) => (
                <tr key={contractor.id}>
                  <td className="px-4 py-2.5 text-slate-800">{contractor.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{contractor.contact_person ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{contractor.contact_number ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{contractor.email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{contractor.license_number ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" to={`/bac/contractors/${contractor.id}`}>
                        View
                      </Button>
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEditForm(contractor)}>
                        Edit
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
