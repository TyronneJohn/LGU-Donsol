import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileWarning, Gavel, MapPin, Pencil, Save, Upload } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import { useFormDraft, readDraft, clearDraft } from '../../hooks/useFormDraft'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import CurrencyInput from '../../components/ui/CurrencyInput'
import Badge from '@shared/components/ui/Badge'
import { LoadingState } from '@shared/components/ui/LoadingState'
import EmptyState from '@shared/components/ui/EmptyState'
import LocationModal from '../../components/LocationModal'
import { formatCurrency, formatDate } from '@shared/utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
} from '@shared/utils/projectStatus'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'
import { isWithinDonsol } from '@shared/utils/geo'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

const PROCUREMENT_DOC_CATEGORY_LABELS = {
  INVITATION_TO_BID: 'Invitation to Bid',
  BID_BULLETIN: 'Bid Bulletin',
  ABSTRACT_OF_BIDS: 'Abstract of Bids',
  NOTICE_OF_AWARD: 'Notice of Award',
  CONTRACT: 'Contract',
  NOTICE_TO_PROCEED: 'Notice to Proceed',
  PERFORMANCE_BOND: 'Performance Bond',
  OTHER: 'Other',
}

const EMPTY_START_FORM = { mode_of_procurement: '', abc_amount: '', bid_opening_date: '' }
const EMPTY_CONTRACT_FORM = {
  contract_number: '',
  contract_amount: '',
  contract_signed_date: '',
  notice_to_proceed_date: '',
  contract_duration_days: '',
  expected_completion_date: '',
}
const EMPTY_DOC_FORM = { title: '', file: null }

// Contract Duration and Expected Completion Date are two views of the same
// NTP-anchored span — BAC may know either one first (a fixed number of
// calendar days from the bid documents, or a hard target/deadline date), so
// each recomputes the other off NTP Date rather than one being locked to
// always derive from the other. Both return '' if their inputs are
// missing/invalid, rather than showing a stale value.
function computeExpectedCompletion(noticeToProceedDate, contractDurationDays) {
  const days = Number(contractDurationDays)
  if (!noticeToProceedDate || !Number.isFinite(days) || days <= 0) return ''
  const date = new Date(`${noticeToProceedDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function computeDurationDays(noticeToProceedDate, expectedCompletionDate) {
  if (!noticeToProceedDate || !expectedCompletionDate) return ''
  const start = new Date(`${noticeToProceedDate}T00:00:00`)
  const end = new Date(`${expectedCompletionDate}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return ''
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86400000)
  return diffDays > 0 ? diffDays : ''
}

// This page's three forms (Start Procurement, Procurement Details, Contract)
// each keep their own draft, scoped per-projectId + per-form so they never
// collide with each other or with another project. The storage itself now
// lives in hooks/useFormDraft.js, shared with every other form in the app.
const startDraftKey = (projectId) => `bac-procurement-start:${projectId}`
const editDraftKey = (projectId) => `bac-procurement-edit:${projectId}`
const contractDraftKey = (projectId) => `bac-procurement-contract:${projectId}`

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</p>
    </div>
  )
}

export default function BacProcurementDetail() {
  const { projectId } = useParams()
  const toast = useToast()
  const confirm = useConfirm()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [project, setProject] = useState(null)
  const [procurement, setProcurement] = useState(null)
  const [contractors, setContractors] = useState([])
  const [documents, setDocuments] = useState([])

  const [startForm, setStartForm] = useState(() => readDraft(startDraftKey(projectId)) ?? EMPTY_START_FORM)
  const [starting, setStarting] = useState(false)

  const [editForm, setEditForm] = useState(EMPTY_START_FORM)
  const [savingDetails, setSavingDetails] = useState(false)
  const [isEditingDetails, setIsEditingDetails] = useState(false)

  const [awardContractorId, setAwardContractorId] = useState('')
  const [awarding, setAwarding] = useState(false)
  const [isEditingAward, setIsEditingAward] = useState(false)

  const [contractForm, setContractForm] = useState(EMPTY_CONTRACT_FORM)
  const [savingContract, setSavingContract] = useState(false)
  const [isEditingContract, setIsEditingContract] = useState(false)

  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  const [technicalDocuments, setTechnicalDocuments] = useState([])
  const [locationOpen, setLocationOpen] = useState(false)

  async function loadContractors() {
    const { data, error } = await supabase.from('contractors').select('id, name').order('name', { ascending: true })
    if (error) {
      toast.error('Could not load contractors', error.message)
      return
    }
    setContractors(data ?? [])
  }

  async function loadProcurementDetails(procurementId) {
    const { data, error } = await supabase
      .from('procurement_documents')
      .select(
        `id, document_category, title, file_name, storage_path, created_at,
         uploader:profiles!procurement_documents_uploaded_by_fkey(full_name)`,
      )
      .eq('procurement_id', procurementId)
      .order('created_at', { ascending: false })

    if (error) toast.error('Could not load documents', error.message)
    setDocuments(data ?? [])
  }

  async function loadTechnicalDocuments(id) {
    const { data, error } = await supabase
      .from('project_documents')
      .select(
        `id, document_category, title, file_name, storage_path, created_at,
         uploader:profiles!project_documents_uploaded_by_fkey(full_name)`,
      )
      .eq('project_id', id)
      .order('created_at', { ascending: false })

    if (error) {
      toast.error('Could not load technical documents', error.message)
      return
    }
    setTechnicalDocuments(data ?? [])
  }

  async function loadData() {
    setLoading(true)

    const { data: projectData, error: projectError } = await supabase
      .from('projects')
      .select(
        `id, project_code, title, description, project_category, barangay, location_text,
         latitude, longitude, estimated_cost, approved_budget, funding_source,
         start_date_planned, end_date_planned, status, offices(name),
         creator:profiles!projects_created_by_fkey(full_name)`,
      )
      .eq('id', projectId)
      .maybeSingle()

    if (projectError || !projectData) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setProject(projectData)
    await loadTechnicalDocuments(projectData.id)

    const { data: procurementRows, error: procurementError } = await supabase
      .from('procurement')
      .select(
        `id, is_current, status, mode_of_procurement, abc_amount, bid_opening_date, contractor_id,
         contract_number, contract_amount, contract_signed_date, notice_to_proceed_date,
         contract_duration_days, expected_completion_date, created_at,
         contractors(name)`,
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (procurementError) {
      toast.error('Could not load procurement records', procurementError.message)
      setLoading(false)
      return
    }

    const rows = procurementRows ?? []
    const current = rows.find((r) => r.is_current) ?? null
    setProcurement(current)

    if (current) {
      const editDraft = readDraft(editDraftKey(projectId))
      setEditForm(
        editDraft ?? {
          mode_of_procurement: current.mode_of_procurement ?? '',
          abc_amount: current.abc_amount ?? '',
          bid_opening_date: current.bid_opening_date ?? '',
        },
      )
      if (editDraft) setIsEditingDetails(true)

      setAwardContractorId(current.contractor_id ?? '')

      const contractDraft = readDraft(contractDraftKey(projectId))
      setContractForm(
        contractDraft ?? {
          contract_number: current.contract_number ?? '',
          contract_amount: current.contract_amount ?? '',
          contract_signed_date: current.contract_signed_date ?? '',
          notice_to_proceed_date: current.notice_to_proceed_date ?? '',
          contract_duration_days: current.contract_duration_days ?? '',
          expected_completion_date: current.expected_completion_date ?? '',
        },
      )
      if (contractDraft) setIsEditingContract(true)

      await loadProcurementDetails(current.id)
    } else {
      // Default the ABC to Engineering's approved_budget — that figure is
      // the technically-vetted basis for the contract ceiling, so BAC
      // starting from anything else (or blank) would just be retyping a
      // number that already exists on the project. Still a normal editable
      // field if BAC has a reason to diverge from it. A restored draft
      // (the user's own prior edits) always wins over that default.
      const startDraft = readDraft(startDraftKey(projectId))
      setStartForm(startDraft ?? { ...EMPTY_START_FORM, abc_amount: projectData.approved_budget ?? '' })
      setDocuments([])
    }

    await loadContractors()
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [projectId])

  // Each form mirrors itself into storage while it holds anything not yet
  // saved, so a refresh — or anything that unmounts this page — doesn't cost
  // the user their typing. Gated on `loading` so the blank state before
  // loadData() finishes restoring never overwrites a real draft.
  //
  // The clean value each is compared against is what the form would hold with
  // nothing unsaved in it: the ABC default for a procurement not yet started,
  // and the saved procurement row for the two that edit one. A form matching
  // that stores nothing at all, which is also what keeps a blank draft from
  // springing the edit panels open on the next load.
  useFormDraft(
    startDraftKey(projectId),
    startForm,
    { ...EMPTY_START_FORM, abc_amount: project?.approved_budget ?? '' },
    !loading && !procurement,
  )

  useFormDraft(
    editDraftKey(projectId),
    editForm,
    {
      mode_of_procurement: procurement?.mode_of_procurement ?? '',
      abc_amount: procurement?.abc_amount ?? '',
      bid_opening_date: procurement?.bid_opening_date ?? '',
    },
    !loading && isEditingDetails,
  )

  // Contract's form has no separate "start editing" gate the way Procurement
  // Details does — it's shown unconditionally the moment there's no saved
  // contract yet (see hasSavedContract below), so gating this purely on
  // isEditingContract would miss every first-time entry. Recomputed inline
  // from `procurement` rather than reusing the later `hasSavedContract`
  // const, since hooks must run before that declaration (after the
  // loading/notFound early returns) in source order.
  const contractAlreadySaved = Boolean(
    procurement?.contract_number || procurement?.contract_amount || procurement?.contract_signed_date,
  )
  useFormDraft(
    contractDraftKey(projectId),
    contractForm,
    {
      contract_number: procurement?.contract_number ?? '',
      contract_amount: procurement?.contract_amount ?? '',
      contract_signed_date: procurement?.contract_signed_date ?? '',
      notice_to_proceed_date: procurement?.notice_to_proceed_date ?? '',
      contract_duration_days: procurement?.contract_duration_days ?? '',
      expected_completion_date: procurement?.expected_completion_date ?? '',
    },
    !loading && (!contractAlreadySaved || isEditingContract),
  )

  async function handleStartProcurement(event) {
    event.preventDefault()
    setStarting(true)

    const { error } = await supabase.from('procurement').insert({
      project_id: projectId,
      created_by: user.id,
      mode_of_procurement: startForm.mode_of_procurement || null,
      abc_amount: startForm.abc_amount === '' ? null : Number(startForm.abc_amount),
      bid_opening_date: startForm.bid_opening_date || null,
    })

    setStarting(false)
    if (error) {
      toast.error('Could not start procurement', error.message)
      return
    }
    toast.success('Procurement opened', 'The project has moved to For Procurement.')
    setStartForm(EMPTY_START_FORM)
    clearDraft(startDraftKey(projectId))
    loadData()
  }

  async function handleSaveDetails(event) {
    event.preventDefault()
    setSavingDetails(true)

    const { error } = await supabase
      .from('procurement')
      .update({
        mode_of_procurement: editForm.mode_of_procurement || null,
        abc_amount: editForm.abc_amount === '' ? null : Number(editForm.abc_amount),
        bid_opening_date: editForm.bid_opening_date || null,
      })
      .eq('id', procurement.id)

    setSavingDetails(false)
    if (error) {
      toast.error('Could not save procurement details', error.message)
      return
    }
    toast.success('Procurement details saved')
    setIsEditingDetails(false)
    clearDraft(editDraftKey(projectId))
    loadData()
  }

  function handleCancelEditDetails() {
    if (procurement) {
      setEditForm({
        mode_of_procurement: procurement.mode_of_procurement ?? '',
        abc_amount: procurement.abc_amount ?? '',
        bid_opening_date: procurement.bid_opening_date ?? '',
      })
    }
    setIsEditingDetails(false)
    clearDraft(editDraftKey(projectId))
  }

  async function handleRecordAward() {
    if (!awardContractorId) {
      toast.error('Select a contractor', 'Choose the winning bidder before recording the award.')
      return
    }

    const confirmed = await confirm({
      title: 'Record this award?',
      description: 'This sets the winning contractor for the procurement cycle.',
      confirmLabel: 'Record Award',
    })
    if (!confirmed) return

    setAwarding(true)
    const nextStatus = ['NOT_STARTED', 'BIDDING', 'BID_EVALUATION'].includes(procurement.status)
      ? 'AWARDED'
      : procurement.status

    const { error } = await supabase
      .from('procurement')
      .update({ contractor_id: awardContractorId, status: nextStatus })
      .eq('id', procurement.id)

    setAwarding(false)
    if (error) {
      toast.error('Could not record award', error.message)
      return
    }
    toast.success('Award recorded', 'MPDC has been notified.')
    setIsEditingAward(false)
    loadData()
  }

  async function handleSaveContract(event) {
    event.preventDefault()
    setSavingContract(true)

    const payload = {
      contract_number: contractForm.contract_number.trim() || null,
      contract_amount: contractForm.contract_amount === '' ? null : Number(contractForm.contract_amount),
      contract_signed_date: contractForm.contract_signed_date || null,
      notice_to_proceed_date: contractForm.notice_to_proceed_date || null,
      contract_duration_days:
        contractForm.contract_duration_days === '' ? null : Number(contractForm.contract_duration_days),
      expected_completion_date: contractForm.expected_completion_date || null,
    }

    if (payload.contract_signed_date) {
      payload.status = 'CONTRACT_SIGNED'
    }

    const { error } = await supabase.from('procurement').update(payload).eq('id', procurement.id)

    setSavingContract(false)
    if (error) {
      toast.error('Could not save contract', error.message)
      return
    }
    toast.success(
      'Contract saved',
      payload.status === 'CONTRACT_SIGNED' ? 'Project moved to For Implementation.' : undefined,
    )
    setIsEditingContract(false)
    clearDraft(contractDraftKey(projectId))
    loadData()
  }

  function handleCancelEditContract() {
    if (procurement) {
      setContractForm({
        contract_number: procurement.contract_number ?? '',
        contract_amount: procurement.contract_amount ?? '',
        contract_signed_date: procurement.contract_signed_date ?? '',
        notice_to_proceed_date: procurement.notice_to_proceed_date ?? '',
        contract_duration_days: procurement.contract_duration_days ?? '',
        expected_completion_date: procurement.expected_completion_date ?? '',
      })
    }
    setIsEditingContract(false)
    clearDraft(contractDraftKey(projectId))
  }

  async function handleMarkCompleted() {
    const confirmed = await confirm({
      title: 'Mark procurement as completed?',
      description: 'This closes out BAC paperwork for this cycle. It does not affect the project implementation status.',
      confirmLabel: 'Mark Completed',
    })
    if (!confirmed) return

    const { error } = await supabase.from('procurement').update({ status: 'COMPLETED' }).eq('id', procurement.id)
    if (error) {
      toast.error('Could not mark completed', error.message)
      return
    }
    toast.success('Procurement marked completed')
    loadData()
  }

  async function handleUploadDocument(event) {
    event.preventDefault()
    if (!docForm.title.trim()) {
      toast.error('Title required', 'Enter a title for this document.')
      return
    }
    if (!docForm.file) {
      toast.error('Choose a file', 'Select a file to upload.')
      return
    }

    setUploadingDoc(true)
    const path = `${procurement.id}/${crypto.randomUUID()}-${docForm.file.name}`

    const { error: uploadError } = await supabase.storage
      .from('procurement-documents')
      .upload(path, docForm.file, { contentType: docForm.file.type || undefined })
    if (uploadError) {
      toast.error('Could not upload file', uploadError.message)
      setUploadingDoc(false)
      return
    }

    const { error: insertError } = await supabase.from('procurement_documents').insert({
      procurement_id: procurement.id,
      uploaded_by: user.id,
      title: docForm.title.trim(),
      storage_path: path,
      file_name: docForm.file.name,
    })

    setUploadingDoc(false)
    if (insertError) {
      toast.error('Could not record document', insertError.message)
      return
    }
    setDocForm(EMPTY_DOC_FORM)
    toast.success('Document uploaded')
    loadProcurementDetails(procurement.id)
  }

  async function handleViewDocument(doc) {
    const { data, error } = await supabase.storage.from('procurement-documents').createSignedUrl(doc.storage_path, 300)
    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(getDocumentViewUrl(data.signedUrl, doc.file_name), '_blank', 'noopener,noreferrer')
  }

  async function handleViewTechnicalDocument(doc) {
    const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(doc.storage_path, 300)
    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(getDocumentViewUrl(data.signedUrl, doc.file_name), '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return <LoadingState label="Loading procurement..." />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Project not found"
        action={
          <Button variant="secondary" size="sm" to="/bac/procurement">
            Back to Procurement
          </Button>
        }
      />
    )
  }

  const hasSavedContract = contractAlreadySaved
  const canEditAward = !['CONTRACT_SIGNED', 'COMPLETED'].includes(procurement?.status)

  return (
    <div>
      <PageHeader
        title={project.title}
        description={project.project_code}
        breadcrumbs={[
          { label: 'Dashboard', to: '/bac' },
          { label: 'Procurement', to: '/bac/procurement' },
          { label: project.project_code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={PROJECT_STATUS_TONES[project.status]}>
              {PROJECT_STATUS_LABELS[project.status] ?? project.status}
            </Badge>
            {procurement ? (
              <Badge tone={PROCUREMENT_STATUS_TONES[procurement.status]}>
                {PROCUREMENT_STATUS_LABELS[procurement.status] ?? procurement.status}
              </Badge>
            ) : null}
          </div>
        }
      />

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Project Details</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            MPDC's original information plus Engineering's endorsed figures — read-only here.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Office">{project.offices?.name}</Field>
            <Field label="Submitted by">{project.creator?.full_name}</Field>
            <Field label="Category">{project.project_category}</Field>
            <Field label="Barangay">{project.barangay}</Field>
            <Field label="Location">{project.location_text}</Field>
            <Field label="Coordinates">
              {isWithinDonsol(project.latitude, project.longitude) ? (
                <Button variant="secondary" size="sm" icon={MapPin} onClick={() => setLocationOpen(true)}>
                  See Location
                </Button>
              ) : (
                <span className="text-slate-400">No location on file for Donsol, Sorsogon.</span>
              )}
            </Field>
            <Field label="Estimated Cost">{formatCurrency(project.estimated_cost)}</Field>
            <Field label="Approved Budget">{formatCurrency(project.approved_budget)}</Field>
            <Field label="Funding Source">{project.funding_source}</Field>
            <Field label="Planned Start">{formatDate(project.start_date_planned)}</Field>
            <Field label="Planned End">{formatDate(project.end_date_planned)}</Field>
          </div>
          <div className="mt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Description</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">{project.description || '—'}</p>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Technical Documents</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Uploaded by MPDC and Engineering during planning and review.
          </p>

          {technicalDocuments.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No documents uploaded yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {technicalDocuments.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm text-slate-800">{doc.title}</p>
                    <p className="text-xs text-slate-500">
                      uploaded by {doc.uploader?.full_name ?? '—'} · {formatDate(doc.created_at)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleViewTechnicalDocument(doc)}>
                    View
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!procurement ? (
          <form onSubmit={handleStartProcurement} className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
            <h2 className="text-sm font-semibold text-slate-800">Start Procurement</h2>
            <p className="mt-1 text-sm text-slate-500">
              Opening a procurement cycle moves this project to For Procurement.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="mode" className="mb-1 block text-sm font-medium text-slate-700">
                  Mode of Procurement
                </label>
                <input
                  id="mode"
                  placeholder="e.g. Public Bidding"
                  value={startForm.mode_of_procurement}
                  onChange={(event) => setStartForm((f) => ({ ...f, mode_of_procurement: event.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="abc" className="mb-1 block text-sm font-medium text-slate-700">
                  Approved Budget for the Contract (ABC)
                </label>
                <CurrencyInput
                  id="abc"
                  value={startForm.abc_amount}
                  onChange={(value) => setStartForm((f) => ({ ...f, abc_amount: value }))}
                  className={inputClass}
                />
                {project.approved_budget != null ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Defaulted to Engineering's approved budget — adjust if needed.
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="bid_opening" className="mb-1 block text-sm font-medium text-slate-700">
                  Bid Opening Date
                </label>
                <input
                  id="bid_opening"
                  type="date"
                  value={startForm.bid_opening_date}
                  onChange={(event) => setStartForm((f) => ({ ...f, bid_opening_date: event.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="mt-5">
              <Button type="submit" icon={Gavel} loading={starting}>
                Start Procurement
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800">Procurement Details</h2>
                {!isEditingDetails ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={Pencil}
                    onClick={() => setIsEditingDetails(true)}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>

              {isEditingDetails ? (
                <form onSubmit={handleSaveDetails}>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div>
                      <label htmlFor="edit_mode" className="mb-1 block text-sm font-medium text-slate-700">
                        Mode of Procurement
                      </label>
                      <input
                        id="edit_mode"
                        placeholder="e.g. Public Bidding"
                        value={editForm.mode_of_procurement}
                        onChange={(event) => setEditForm((f) => ({ ...f, mode_of_procurement: event.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit_abc" className="mb-1 block text-sm font-medium text-slate-700">
                        ABC
                      </label>
                      <CurrencyInput
                        id="edit_abc"
                        value={editForm.abc_amount}
                        onChange={(value) => setEditForm((f) => ({ ...f, abc_amount: value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="edit_bid_opening" className="mb-1 block text-sm font-medium text-slate-700">
                        Bid Opening Date
                      </label>
                      <input
                        id="edit_bid_opening"
                        type="date"
                        value={editForm.bid_opening_date}
                        onChange={(event) => setEditForm((f) => ({ ...f, bid_opening_date: event.target.value }))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <Button type="submit" size="sm" icon={Save} loading={savingDetails}>
                      Save Details
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={handleCancelEditDetails}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <Field label="Mode of Procurement">{procurement.mode_of_procurement}</Field>
                  <Field label="ABC">{formatCurrency(procurement.abc_amount)}</Field>
                  <Field label="Bid Opening Date">{formatDate(procurement.bid_opening_date)}</Field>
                </div>
              )}
            </div>

            <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
              <h2 className="text-sm font-semibold text-slate-800">Award &amp; Contract</h2>

              <div className="mt-4">
                {procurement.contractor_id && !isEditingAward ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Field label="Winning Contractor">{procurement.contractors?.name}</Field>
                    {canEditAward ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={Pencil}
                        onClick={() => setIsEditingAward(true)}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-55">
                      <label htmlFor="award_contractor" className="mb-1 block text-sm font-medium text-slate-700">
                        Winning Contractor
                      </label>
                      <select
                        id="award_contractor"
                        value={awardContractorId}
                        onChange={(event) => setAwardContractorId(event.target.value)}
                        className={inputClass}
                      >
                        <option value="">Select contractor</option>
                        {contractors.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      icon={Gavel}
                      loading={awarding}
                      disabled={!awardContractorId || awardContractorId === procurement.contractor_id}
                      onClick={handleRecordAward}
                    >
                      Record Award
                    </Button>
                    {procurement.contractor_id ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setAwardContractorId(procurement.contractor_id ?? '')
                          setIsEditingAward(false)
                        }}
                      >
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>

              {procurement.contractor_id ? (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">Contract</h3>
                    {hasSavedContract && !isEditingContract ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={Pencil}
                        onClick={() => setIsEditingContract(true)}
                      >
                        Edit
                      </Button>
                    ) : null}
                  </div>

                  {hasSavedContract && !isEditingContract ? (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Contract Number">{procurement.contract_number}</Field>
                      <Field label="Contract Amount">{formatCurrency(procurement.contract_amount)}</Field>
                      <Field label="Contract Signed Date">{formatDate(procurement.contract_signed_date)}</Field>
                      <Field label="Notice to Proceed Date">{formatDate(procurement.notice_to_proceed_date)}</Field>
                      <Field label="Contract Duration (days)">{procurement.contract_duration_days}</Field>
                      <Field label="Expected Completion Date">
                        {formatDate(procurement.expected_completion_date)}
                      </Field>
                    </div>
                  ) : (
                    <form onSubmit={handleSaveContract} className="mt-4">
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <label htmlFor="contract_number" className="mb-1 block text-sm font-medium text-slate-700">
                            Contract Number
                          </label>
                          <input
                            id="contract_number"
                            value={contractForm.contract_number}
                            onChange={(event) =>
                              setContractForm((f) => ({ ...f, contract_number: event.target.value }))
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label htmlFor="contract_amount" className="mb-1 block text-sm font-medium text-slate-700">
                            Contract Amount
                          </label>
                          <CurrencyInput
                            id="contract_amount"
                            value={contractForm.contract_amount}
                            onChange={(value) => setContractForm((f) => ({ ...f, contract_amount: value }))}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="contract_signed_date"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Contract Signed Date
                          </label>
                          <input
                            id="contract_signed_date"
                            type="date"
                            value={contractForm.contract_signed_date}
                            onChange={(event) =>
                              setContractForm((f) => ({ ...f, contract_signed_date: event.target.value }))
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label htmlFor="ntp_date" className="mb-1 block text-sm font-medium text-slate-700">
                            Notice to Proceed Date
                          </label>
                          <input
                            id="ntp_date"
                            type="date"
                            value={contractForm.notice_to_proceed_date}
                            onChange={(event) => {
                              const notice_to_proceed_date = event.target.value
                              setContractForm((f) => {
                                if (f.contract_duration_days) {
                                  return {
                                    ...f,
                                    notice_to_proceed_date,
                                    expected_completion_date: computeExpectedCompletion(
                                      notice_to_proceed_date,
                                      f.contract_duration_days,
                                    ),
                                  }
                                }
                                if (f.expected_completion_date) {
                                  return {
                                    ...f,
                                    notice_to_proceed_date,
                                    contract_duration_days: computeDurationDays(
                                      notice_to_proceed_date,
                                      f.expected_completion_date,
                                    ),
                                  }
                                }
                                return { ...f, notice_to_proceed_date }
                              })
                            }}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label htmlFor="duration" className="mb-1 block text-sm font-medium text-slate-700">
                            Contract Duration (days)
                          </label>
                          <input
                            id="duration"
                            type="number"
                            min="1"
                            value={contractForm.contract_duration_days}
                            onChange={(event) => {
                              const contract_duration_days = event.target.value
                              setContractForm((f) => ({
                                ...f,
                                contract_duration_days,
                                expected_completion_date: computeExpectedCompletion(
                                  f.notice_to_proceed_date,
                                  contract_duration_days,
                                ),
                              }))
                            }}
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor="expected_completion"
                            className="mb-1 block text-sm font-medium text-slate-700"
                          >
                            Expected Completion Date
                          </label>
                          <input
                            id="expected_completion"
                            type="date"
                            value={contractForm.expected_completion_date}
                            onChange={(event) => {
                              const expected_completion_date = event.target.value
                              setContractForm((f) => ({
                                ...f,
                                expected_completion_date,
                                contract_duration_days: computeDurationDays(
                                  f.notice_to_proceed_date,
                                  expected_completion_date,
                                ),
                              }))
                            }}
                            className={inputClass}
                          />
                          <p className="mt-1 text-xs text-slate-400">
                            Enter either this or Contract Duration — the other fills in automatically from Notice
                            to Proceed Date.
                          </p>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        Setting a contract signed date marks the contract as signed and moves the project to For
                        Implementation.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Button type="submit" size="sm" icon={Save} loading={savingContract}>
                          Save Contract
                        </Button>
                        {hasSavedContract ? (
                          <Button type="button" variant="ghost" size="sm" onClick={handleCancelEditContract}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </form>
                  )}

                  {procurement.status === 'CONTRACT_SIGNED' ? (
                    <div className="mt-3">
                      <Button type="button" variant="secondary" size="sm" onClick={handleMarkCompleted}>
                        Mark Procurement Completed
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
              <h2 className="text-sm font-semibold text-slate-800">Procurement Documents</h2>

              {documents.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No documents uploaded yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div>
                        <p className="text-sm text-slate-800">{doc.title}</p>
                        <p className="text-xs text-slate-500">
                          {PROCUREMENT_DOC_CATEGORY_LABELS[doc.document_category] ?? doc.document_category} ·
                          uploaded by {doc.uploader?.full_name ?? '—'} · {formatDate(doc.created_at)}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => handleViewDocument(doc)}>
                        View
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <form
                onSubmit={handleUploadDocument}
                className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
              >
                <div>
                  <label htmlFor="doc_title" className="mb-1 block text-sm font-medium text-slate-700">
                    Title
                  </label>
                  <input
                    id="doc_title"
                    value={docForm.title}
                    onChange={(event) => setDocForm((f) => ({ ...f, title: event.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label htmlFor="doc_file" className="mb-1 block text-sm font-medium text-slate-700">
                    File
                  </label>
                  <input
                    id="doc_file"
                    type="file"
                    onChange={(event) => setDocForm((f) => ({ ...f, file: event.target.files?.[0] ?? null }))}
                    className="block w-full text-sm text-slate-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-50"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" variant="secondary" size="sm" icon={Upload} loading={uploadingDoc}>
                    Upload
                  </Button>
                </div>
              </form>
            </section>
          </>
        )}
      </div>

      <LocationModal open={locationOpen} project={project} onClose={() => setLocationOpen(false)} />
    </div>
  )
}
