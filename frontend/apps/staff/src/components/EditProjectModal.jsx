import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Pencil, Plus, RefreshCw, Trash2, Undo2, X } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../hooks/useToast'
import { useAuth } from '../hooks/useAuth'
import Button from './ui/Button'
import CurrencyInput from './ui/CurrencyInput'
import { SECTOR_LABELS } from '@shared/utils/projectStatus'
import { DONSOL_BARANGAYS } from '@shared/utils/barangays'
import { DONSOL_BARANGAY_CENTROIDS } from '@shared/utils/barangayCentroids'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

export const DOC_CATEGORY_LABELS = {
  PROGRAM_OF_WORKS: 'Program of Works',
  PERMIT: 'Permit',
  DESIGN_PLAN: 'Design Plan',
  OTHER: 'Other',
}

// Same bucket and path scheme as the MPDC/Engineering uploaders.
async function uploadDocument(projectId, userId, file, { title, category }) {
  const path = `${projectId}/${crypto.randomUUID()}-${file.name}`
  const { error: uploadError } = await supabase.storage
    .from('project-documents')
    .upload(path, file, { contentType: file.type || undefined })
  if (uploadError) return uploadError

  const { error: insertError } = await supabase.from('project_documents').insert({
    project_id: projectId,
    uploaded_by: userId,
    document_category: category,
    title: title || file.name,
    storage_path: path,
    file_name: file.name,
  })
  if (insertError) {
    await supabase.storage.from('project-documents').remove([path])
  }
  return insertError
}

async function deleteDocument(doc) {
  const { error } = await supabase.from('project_documents').delete().eq('id', doc.id)
  if (error) return error
  // Best effort — the row is what the app reads, so an orphaned object in
  // storage is harmless if this fails.
  await supabase.storage.from('project-documents').remove([doc.storage_path])
  return null
}

function toForm(project) {
  return {
    title: project.title ?? '',
    description: project.description ?? '',
    project_category: project.project_category ?? '',
    sector: project.sector ?? '',
    barangay: project.barangay ?? '',
    location_text: project.location_text ?? '',
    latitude: project.latitude ?? '',
    longitude: project.longitude ?? '',
    estimated_cost: project.estimated_cost == null ? '' : String(project.estimated_cost),
    approved_budget: project.approved_budget == null ? '' : String(project.approved_budget),
    funding_source: project.funding_source ?? '',
    start_date_planned: project.start_date_planned ?? '',
    end_date_planned: project.end_date_planned ?? '',
    start_date_actual: project.start_date_actual ?? '',
    end_date_actual: project.end_date_actual ?? '',
  }
}

function Field({ id, label, className = '', children }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  )
}

// Admin's in-place edit of a project's details, replacing the old hard
// delete on the admin project page. Admins bypass the column fences in
// guard_project_field_updates, so every field here is writable regardless of
// the project's status. Status itself is intentionally not editable — it
// stays driven by the submission/review/procurement workflow.
//
// Documents are staged here and only applied on Save. project_documents has
// no UPDATE policy, so replacing a wrong file is an upload of the new one
// followed by deleting the old row and object — both already allowed for
// admins.
export default function EditProjectModal({ open, project, documents = [], onClose, onSaved }) {
  const toast = useToast()
  const { user } = useAuth()
  const [form, setForm] = useState(() => (project ? toForm(project) : null))
  const [saving, setSaving] = useState(false)
  // doc id -> { action: 'replace', file } | { action: 'remove' }
  const [docChanges, setDocChanges] = useState({})
  const [newDocs, setNewDocs] = useState([])
  const [newDocCategory, setNewDocCategory] = useState('OTHER')
  const replaceInputRef = useRef(null)
  const replaceTargetRef = useRef(null)
  const addInputRef = useRef(null)

  useEffect(() => {
    if (open && project) {
      setForm(toForm(project))
      setDocChanges({})
      setNewDocs([])
      setNewDocCategory('OTHER')
    }
  }, [open, project])

  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event) {
      if (event.key === 'Escape' && !saving) onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, saving])

  if (!open || !project || !form) return null

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  // Same rule as the MPDC form: coordinates always follow the barangay's
  // centroid, never typed by hand.
  function selectBarangay(barangay) {
    const centroid = DONSOL_BARANGAY_CENTROIDS[barangay]
    setForm((current) => ({
      ...current,
      barangay,
      latitude: centroid?.lat ?? '',
      longitude: centroid?.lng ?? '',
    }))
  }

  function pickReplacement(doc) {
    replaceTargetRef.current = doc
    replaceInputRef.current?.click()
  }

  function handleReplacementChosen(event) {
    const file = event.target.files?.[0]
    const doc = replaceTargetRef.current
    event.target.value = ''
    if (!file || !doc) return
    setDocChanges((current) => ({ ...current, [doc.id]: { action: 'replace', file } }))
  }

  function markRemoved(doc) {
    setDocChanges((current) => ({ ...current, [doc.id]: { action: 'remove' } }))
  }

  function undoDocChange(doc) {
    setDocChanges((current) => {
      const next = { ...current }
      delete next[doc.id]
      return next
    })
  }

  function handleNewFilesChosen(event) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    setNewDocs((current) => [
      ...current,
      ...files.map((file) => ({ key: crypto.randomUUID(), file, category: newDocCategory })),
    ])
  }

  function removeNewDoc(key) {
    setNewDocs((current) => current.filter((entry) => entry.key !== key))
  }

  // Returns the names of any files that failed, so one bad file doesn't hide
  // the rest having gone through.
  async function applyDocumentChanges() {
    const failed = []

    for (const doc of documents) {
      const change = docChanges[doc.id]
      if (!change) continue

      if (change.action === 'replace') {
        // Keep a custom title; only follow the file name when the title was
        // just the old file name to begin with.
        const title = doc.title && doc.title !== doc.file_name ? doc.title : change.file.name
        const uploadError = await uploadDocument(project.id, user.id, change.file, {
          title,
          category: doc.document_category,
        })
        if (uploadError) {
          failed.push(change.file.name)
          continue
        }
        if (await deleteDocument(doc)) failed.push(`${doc.file_name ?? doc.title} (old copy not removed)`)
      } else if (change.action === 'remove') {
        if (await deleteDocument(doc)) failed.push(doc.file_name ?? doc.title)
      }
    }

    for (const entry of newDocs) {
      const uploadError = await uploadDocument(project.id, user.id, entry.file, { category: entry.category })
      if (uploadError) failed.push(entry.file.name)
    }

    return failed
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.title.trim()) {
      toast.error('Project name required')
      return
    }
    if (form.start_date_planned && form.end_date_planned && form.end_date_planned < form.start_date_planned) {
      toast.error('Invalid schedule', 'Target completion date cannot be before the proposed start date.')
      return
    }
    if (form.start_date_actual && form.end_date_actual && form.end_date_actual < form.start_date_actual) {
      toast.error('Invalid schedule', 'Actual end date cannot be before the actual start date.')
      return
    }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      project_category: form.project_category.trim() || null,
      sector: form.sector || null,
      barangay: form.barangay.trim() || null,
      location_text: form.location_text.trim() || null,
      latitude: form.latitude === '' ? null : Number(form.latitude),
      longitude: form.longitude === '' ? null : Number(form.longitude),
      estimated_cost: form.estimated_cost === '' ? null : Number(form.estimated_cost),
      approved_budget: form.approved_budget === '' ? null : Number(form.approved_budget),
      funding_source: form.funding_source.trim() || null,
      start_date_planned: form.start_date_planned || null,
      end_date_planned: form.end_date_planned || null,
      start_date_actual: form.start_date_actual || null,
      end_date_actual: form.end_date_actual || null,
    }

    setSaving(true)
    const { error } = await supabase.from('projects').update(payload).eq('id', project.id)

    if (error) {
      setSaving(false)
      toast.error('Could not save changes', error.message)
      return
    }

    const failed = await applyDocumentChanges()
    setSaving(false)

    if (failed.length > 0) {
      toast.error('Project saved, but some files failed', failed.join(', '))
    } else {
      toast.success('Project updated', `${project.project_code} has been updated.`)
    }
    onSaved?.()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={() => !saving && onClose?.()}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-project-modal-title"
        onSubmit={handleSubmit}
        className="animate-pop-in relative flex max-h-full w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 id="edit-project-modal-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <Pencil className="h-4 w-4 text-blue-600" aria-hidden="true" />
              Edit Project
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">{project.project_code}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          <Field id="edit-title" label="Project Name *" className="sm:col-span-2">
            <input
              id="edit-title"
              required
              value={form.title}
              onChange={(event) => updateField('title', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-description" label="Description" className="sm:col-span-2">
            <textarea
              id="edit-description"
              rows={3}
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-project-category" label="Programs/Project/Activities">
            <input
              id="edit-project-category"
              value={form.project_category}
              onChange={(event) => updateField('project_category', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-sector" label="Category">
            <select
              id="edit-sector"
              value={form.sector}
              onChange={(event) => updateField('sector', event.target.value)}
              className={inputClass}
            >
              <option value="">Select a category</option>
              {Object.entries(SECTOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field id="edit-barangay" label="Barangay">
            <select
              id="edit-barangay"
              value={form.barangay}
              onChange={(event) => selectBarangay(event.target.value)}
              className={inputClass}
            >
              <option value="">Select a barangay</option>
              {DONSOL_BARANGAYS.map((barangay) => (
                <option key={barangay} value={barangay}>
                  {barangay}
                </option>
              ))}
            </select>
          </Field>

          <Field id="edit-location-text" label="Location">
            <input
              id="edit-location-text"
              placeholder="Purok / sitio / landmark"
              value={form.location_text}
              onChange={(event) => updateField('location_text', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-estimated-cost" label="Estimated Budget (PHP)">
            <CurrencyInput
              id="edit-estimated-cost"
              value={form.estimated_cost}
              onChange={(value) => updateField('estimated_cost', value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-approved-budget" label="Approved Budget (PHP)">
            <CurrencyInput
              id="edit-approved-budget"
              value={form.approved_budget}
              onChange={(value) => updateField('approved_budget', value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-funding-source" label="Funding Source" className="sm:col-span-2">
            <input
              id="edit-funding-source"
              value={form.funding_source}
              onChange={(event) => updateField('funding_source', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-start-planned" label="Planned Start">
            <input
              id="edit-start-planned"
              type="date"
              value={form.start_date_planned}
              onChange={(event) => updateField('start_date_planned', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-end-planned" label="Planned End">
            <input
              id="edit-end-planned"
              type="date"
              value={form.end_date_planned}
              onChange={(event) => updateField('end_date_planned', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-start-actual" label="Actual Start">
            <input
              id="edit-start-actual"
              type="date"
              value={form.start_date_actual}
              onChange={(event) => updateField('start_date_actual', event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field id="edit-end-actual" label="Actual End">
            <input
              id="edit-end-actual"
              type="date"
              value={form.end_date_actual}
              onChange={(event) => updateField('end_date_actual', event.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-2 border-t border-slate-100 pt-4">
            <p className="text-sm font-medium text-slate-700">Project Documents</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Replace a wrongly uploaded file, remove one, or add another. Nothing changes until you click Save
              Changes.
            </p>

            <input ref={replaceInputRef} type="file" className="hidden" onChange={handleReplacementChosen} />
            <input ref={addInputRef} type="file" multiple className="hidden" onChange={handleNewFilesChosen} />

            {documents.length === 0 && newDocs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No documents uploaded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
                {documents.map((doc) => {
                  const change = docChanges[doc.id]
                  return (
                    <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        <div className="min-w-0">
                          <p
                            className={`truncate text-sm ${
                              change?.action === 'remove' ? 'text-slate-400 line-through' : 'text-slate-800'
                            }`}
                          >
                            {doc.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {DOC_CATEGORY_LABELS[doc.document_category] ?? doc.document_category}
                            {' · '}
                            {change?.action === 'replace' ? (
                              <>
                                <span className="line-through">{doc.file_name}</span>
                                <span className="font-medium text-blue-700"> → {change.file.name}</span>
                              </>
                            ) : change?.action === 'remove' ? (
                              <span className="font-medium text-red-600">will be removed</span>
                            ) : (
                              doc.file_name
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {change ? (
                          <Button type="button" variant="ghost" size="sm" icon={Undo2} onClick={() => undoDocChange(doc)}>
                            Undo
                          </Button>
                        ) : (
                          <>
                            <Button type="button" variant="ghost" size="sm" icon={RefreshCw} onClick={() => pickReplacement(doc)}>
                              Replace
                            </Button>
                            <Button type="button" variant="ghost" size="sm" icon={Trash2} onClick={() => markRemoved(doc)}>
                              Remove
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  )
                })}
                {newDocs.map((entry) => (
                  <li key={entry.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-800">{entry.file.name}</p>
                        <p className="text-xs text-blue-700">
                          New · {DOC_CATEGORY_LABELS[entry.category] ?? entry.category}
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" icon={X} onClick={() => removeNewDoc(entry.key)}>
                      Cancel
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                aria-label="Category for new documents"
                value={newDocCategory}
                onChange={(event) => setNewDocCategory(event.target.value)}
                className={`${inputClass} w-auto`}
              >
                {Object.entries(DOC_CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => addInputRef.current?.click()}>
                Add Document
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save Changes
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
