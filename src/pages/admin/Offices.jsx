import { useEffect, useState } from 'react'
import { Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

const EMPTY_FORM = { code: '', name: '', description: '' }

export default function Offices() {
  const toast = useToast()
  const confirm = useConfirm()
  const [offices, setOffices] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function loadOffices() {
    setLoading(true)
    const { data, error } = await supabase.from('offices').select('id, code, name, description').order('name', { ascending: true })

    if (error) {
      toast.error('Could not load offices', error.message)
    } else {
      setOffices(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadOffices()
  }, [])

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function openAddForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditForm(office) {
    setEditingId(office.id)
    setForm({ code: office.code, name: office.name, description: office.description ?? '' })
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.code.trim() || !form.name.trim()) {
      toast.error('Code and name are required')
      return
    }

    setSaving(true)
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      description: form.description.trim() || null,
    }

    const { error } = editingId
      ? await supabase.from('offices').update(payload).eq('id', editingId)
      : await supabase.from('offices').insert(payload)

    setSaving(false)

    if (error) {
      toast.error(editingId ? 'Could not update office' : 'Could not create office', error.message)
      return
    }

    toast.success(editingId ? 'Office updated' : 'Office created')
    closeForm()
    loadOffices()
  }

  async function handleDelete(office) {
    const confirmed = await confirm({
      title: `Delete ${office.name}?`,
      description: 'Staff assigned to this office will keep their account but lose their office assignment.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!confirmed) return

    const { error } = await supabase.from('offices').delete().eq('id', office.id)

    if (error) {
      if (error.code === '23503') {
        toast.error('Could not delete office', 'It still has projects assigned to it.')
      } else {
        toast.error('Could not delete office', error.message)
      }
      return
    }

    toast.success('Office deleted')
    loadOffices()
  }

  return (
    <div>
      <PageHeader
        title="Offices"
        description="Manage the offices staff accounts and projects belong to."
        breadcrumbs={[{ label: 'Dashboard', to: '/admin' }, { label: 'Offices' }]}
        actions={
          <Button icon={Plus} onClick={() => (formOpen && !editingId ? closeForm() : openAddForm())}>
            {formOpen && !editingId ? 'Cancel' : 'Add Office'}
          </Button>
        }
      />

      {formOpen ? (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2"
        >
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-slate-700">
              Code
            </label>
            <input
              id="code"
              required
              value={form.code}
              onChange={(event) => updateField('code', event.target.value)}
              className={inputClass}
              placeholder="e.g. ENGG"
            />
          </div>

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              id="name"
              required
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              className={inputClass}
              placeholder="e.g. Engineering Office"
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="description" className="mb-1 block text-sm font-medium text-slate-700">
              Description (optional)
            </label>
            <textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" loading={saving}>
              {editingId ? 'Save Changes' : 'Create Office'}
            </Button>
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <LoadingState label="Loading offices..." />
      ) : offices.length === 0 ? (
        <EmptyState icon={Landmark} title="No offices yet" description="Offices you create will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Code</th>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {offices.map((office) => (
                <tr key={office.id}>
                  <td className="px-4 py-2.5 text-slate-800">{office.code}</td>
                  <td className="px-4 py-2.5 text-slate-800">{office.name}</td>
                  <td className="px-4 py-2.5 text-slate-600">{office.description ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEditForm(office)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" icon={Trash2} onClick={() => handleDelete(office)}>
                        Delete
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
