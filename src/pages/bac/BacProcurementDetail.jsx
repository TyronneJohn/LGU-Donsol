import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileWarning, Gavel, Repeat, Save, Upload, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import { useConfirm } from '../../hooks/useConfirm'
import { useAuth } from '../../hooks/useAuth'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  PROCUREMENT_STATUS_LABELS,
  PROCUREMENT_STATUS_TONES,
  PROCUREMENT_ELIGIBLE_STATUSES,
  BID_STATUS_LABELS,
} from '../../utils/projectStatus'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'
const textareaClass = inputClass

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

const MODE_OF_PROCUREMENT_OPTIONS = [
  'Public Bidding',
  'Negotiated Procurement',
  'Shopping',
  'Direct Contracting',
  'Small Value Procurement',
  'Other',
]

const EMPTY_START_FORM = { mode_of_procurement: '', abc_amount: '', bid_opening_date: '' }
const EMPTY_BIDDER_FORM = { contractor_id: '', bid_amount: '', newContractorName: '' }
const EMPTY_CONTRACT_FORM = {
  contract_number: '',
  contract_amount: '',
  contract_signed_date: '',
  notice_to_proceed_date: '',
  contract_duration_days: '',
  expected_completion_date: '',
}
const EMPTY_DOC_FORM = { category: 'OTHER', title: '', file: null }

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
  const [pastCycles, setPastCycles] = useState([])
  const [bidders, setBidders] = useState([])
  const [contractors, setContractors] = useState([])
  const [documents, setDocuments] = useState([])

  const [startForm, setStartForm] = useState(EMPTY_START_FORM)
  const [starting, setStarting] = useState(false)

  const [editForm, setEditForm] = useState(EMPTY_START_FORM)
  const [savingDetails, setSavingDetails] = useState(false)

  const [statusValue, setStatusValue] = useState('')
  const [savingStatus, setSavingStatus] = useState(false)

  const [bidderForm, setBidderForm] = useState(EMPTY_BIDDER_FORM)
  const [addingBidder, setAddingBidder] = useState(false)
  const [bidderEdits, setBidderEdits] = useState({})
  const [savingBidderId, setSavingBidderId] = useState(null)

  const [awardContractorId, setAwardContractorId] = useState('')
  const [awarding, setAwarding] = useState(false)

  const [contractForm, setContractForm] = useState(EMPTY_CONTRACT_FORM)
  const [savingContract, setSavingContract] = useState(false)

  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM)
  const [uploadingDoc, setUploadingDoc] = useState(false)

  const [rebidding, setRebidding] = useState(false)

  const [technicalDocuments, setTechnicalDocuments] = useState([])

  async function loadContractors() {
    const { data, error } = await supabase.from('contractors').select('id, name').order('name', { ascending: true })
    if (error) {
      toast.error('Could not load contractors', error.message)
      return
    }
    setContractors(data ?? [])
  }

  async function loadProcurementDetails(procurementId) {
    const [biddersResult, documentsResult] = await Promise.all([
      supabase
        .from('procurement_bidders')
        .select(
          `id, contractor_id, bid_amount, bid_status, evaluation_notes, submitted_at,
           contractors(name),
           evaluator:profiles!procurement_bidders_evaluated_by_fkey(full_name)`,
        )
        .eq('procurement_id', procurementId)
        .order('submitted_at', { ascending: true }),
      supabase
        .from('procurement_documents')
        .select(
          `id, document_category, title, file_name, storage_path, created_at,
           uploader:profiles!procurement_documents_uploaded_by_fkey(full_name)`,
        )
        .eq('procurement_id', procurementId)
        .order('created_at', { ascending: false }),
    ])

    if (biddersResult.error) toast.error('Could not load bidders', biddersResult.error.message)
    if (documentsResult.error) toast.error('Could not load documents', documentsResult.error.message)

    setBidders(biddersResult.data ?? [])
    setDocuments(documentsResult.data ?? [])
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
    setPastCycles(rows.filter((r) => !r.is_current))

    if (current) {
      setEditForm({
        mode_of_procurement: current.mode_of_procurement ?? '',
        abc_amount: current.abc_amount ?? '',
        bid_opening_date: current.bid_opening_date ?? '',
      })
      setStatusValue(current.status)
      setAwardContractorId(current.contractor_id ?? '')
      setContractForm({
        contract_number: current.contract_number ?? '',
        contract_amount: current.contract_amount ?? '',
        contract_signed_date: current.contract_signed_date ?? '',
        notice_to_proceed_date: current.notice_to_proceed_date ?? '',
        contract_duration_days: current.contract_duration_days ?? '',
        expected_completion_date: current.expected_completion_date ?? '',
      })
      await loadProcurementDetails(current.id)
    } else {
      setBidders([])
      setDocuments([])
    }

    await loadContractors()
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [projectId])

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
    loadData()
  }

  async function handleUpdateStatus(event) {
    event.preventDefault()
    if (statusValue === procurement.status) return

    setSavingStatus(true)
    const { error } = await supabase.from('procurement').update({ status: statusValue }).eq('id', procurement.id)
    setSavingStatus(false)

    if (error) {
      toast.error('Could not update status', error.message)
      return
    }
    toast.success('Procurement status updated')
    loadData()
  }

  async function handleAddBidder(event) {
    event.preventDefault()

    if (!bidderForm.contractor_id && !bidderForm.newContractorName.trim()) {
      toast.error('Contractor required', 'Select an existing contractor or enter a new one.')
      return
    }

    setAddingBidder(true)
    let contractorId = bidderForm.contractor_id

    if (!contractorId && bidderForm.newContractorName.trim()) {
      const { data: newContractor, error: contractorError } = await supabase
        .from('contractors')
        .insert({ name: bidderForm.newContractorName.trim() })
        .select('id')
        .single()

      if (contractorError) {
        toast.error('Could not create contractor', contractorError.message)
        setAddingBidder(false)
        return
      }
      contractorId = newContractor.id
    }

    const { error } = await supabase.from('procurement_bidders').insert({
      procurement_id: procurement.id,
      contractor_id: contractorId,
      bid_amount: bidderForm.bid_amount === '' ? null : Number(bidderForm.bid_amount),
      created_by: user.id,
    })

    setAddingBidder(false)
    if (error) {
      toast.error('Could not record bidder', error.message)
      return
    }
    toast.success('Bidder recorded')
    setBidderForm(EMPTY_BIDDER_FORM)
    loadContractors()
    loadProcurementDetails(procurement.id)
  }

  function updateBidderEdit(id, field, value) {
    setBidderEdits((current) => ({
      ...current,
      [id]: { ...(current[id] ?? {}), [field]: value },
    }))
  }

  async function handleSaveBidderEvaluation(bidder) {
    const edit = bidderEdits[bidder.id]
    if (!edit) return

    setSavingBidderId(bidder.id)
    const { error } = await supabase
      .from('procurement_bidders')
      .update({
        bid_status: edit.bid_status ?? bidder.bid_status,
        evaluation_notes: edit.evaluation_notes ?? bidder.evaluation_notes,
        evaluated_by: user.id,
        evaluated_at: new Date().toISOString(),
      })
      .eq('id', bidder.id)

    setSavingBidderId(null)
    if (error) {
      toast.error('Could not save evaluation', error.message)
      return
    }
    toast.success('Evaluation saved')
    loadProcurementDetails(procurement.id)
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
    loadData()
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
    if (!docForm.file) {
      toast.error('Choose a file', 'Select a file to upload.')
      return
    }

    setUploadingDoc(true)
    const path = `${procurement.id}/${crypto.randomUUID()}-${docForm.file.name}`

    const { error: uploadError } = await supabase.storage.from('procurement-documents').upload(path, docForm.file)
    if (uploadError) {
      toast.error('Could not upload file', uploadError.message)
      setUploadingDoc(false)
      return
    }

    const { error: insertError } = await supabase.from('procurement_documents').insert({
      procurement_id: procurement.id,
      uploaded_by: user.id,
      document_category: docForm.category,
      title: docForm.title.trim() || docForm.file.name,
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
    const { data, error } = await supabase.storage.from('procurement-documents').createSignedUrl(doc.storage_path, 60)
    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleViewTechnicalDocument(doc) {
    const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(doc.storage_path, 60)
    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleRebid() {
    const confirmed = await confirm({
      title: 'Start a new procurement cycle?',
      description: 'The current cycle will be kept as history and a new cycle will be opened for this project.',
      confirmLabel: 'Start New Cycle',
    })
    if (!confirmed) return

    setRebidding(true)
    const { error: closeError } = await supabase
      .from('procurement')
      .update({ is_current: false })
      .eq('id', procurement.id)

    if (closeError) {
      toast.error('Could not close current cycle', closeError.message)
      setRebidding(false)
      return
    }

    const { error: insertError } = await supabase.from('procurement').insert({
      project_id: projectId,
      created_by: user.id,
    })

    setRebidding(false)
    if (insertError) {
      toast.error('Could not open new cycle', insertError.message)
      return
    }
    toast.success('New procurement cycle opened')
    loadData()
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

  const eligibleForNewCycle = PROCUREMENT_ELIGIBLE_STATUSES.includes(project.status)

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
        <section className="rounded-lg border border-slate-200 bg-white p-5">
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

        <section className="rounded-lg border border-slate-200 bg-white p-5">
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
          <form onSubmit={handleStartProcurement} className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-800">Start Procurement</h2>
            <p className="mt-1 text-sm text-slate-500">
              Opening a procurement cycle moves this project to For Procurement.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="mode" className="mb-1 block text-sm font-medium text-slate-700">
                  Mode of Procurement
                </label>
                <select
                  id="mode"
                  value={startForm.mode_of_procurement}
                  onChange={(event) => setStartForm((f) => ({ ...f, mode_of_procurement: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">Select mode</option>
                  {MODE_OF_PROCUREMENT_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="abc" className="mb-1 block text-sm font-medium text-slate-700">
                  Approved Budget for the Contract (ABC)
                </label>
                <input
                  id="abc"
                  type="number"
                  step="0.01"
                  min="0"
                  value={startForm.abc_amount}
                  onChange={(event) => setStartForm((f) => ({ ...f, abc_amount: event.target.value }))}
                  className={inputClass}
                />
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
            <form onSubmit={handleSaveDetails} className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800">Procurement Details</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="edit_mode" className="mb-1 block text-sm font-medium text-slate-700">
                    Mode of Procurement
                  </label>
                  <select
                    id="edit_mode"
                    value={editForm.mode_of_procurement}
                    onChange={(event) => setEditForm((f) => ({ ...f, mode_of_procurement: event.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select mode</option>
                    {MODE_OF_PROCUREMENT_OPTIONS.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit_abc" className="mb-1 block text-sm font-medium text-slate-700">
                    ABC
                  </label>
                  <input
                    id="edit_abc"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editForm.abc_amount}
                    onChange={(event) => setEditForm((f) => ({ ...f, abc_amount: event.target.value }))}
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
                {eligibleForNewCycle ? (
                  <Button type="button" variant="secondary" size="sm" icon={Repeat} loading={rebidding} onClick={handleRebid}>
                    Start New Cycle (Rebid)
                  </Button>
                ) : null}
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <label htmlFor="status" className="mb-1 block text-sm font-medium text-slate-700">
                  Procurement Status
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="status"
                    value={statusValue}
                    onChange={(event) => setStatusValue(event.target.value)}
                    className={`${inputClass} max-w-55`}
                  >
                    {Object.entries(PROCUREMENT_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={savingStatus}
                    disabled={statusValue === procurement.status}
                    onClick={handleUpdateStatus}
                  >
                    Update Status
                  </Button>
                </div>
              </div>
            </form>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800">Bidders</h2>

              {bidders.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No bidders recorded yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {bidders.map((bidder) => {
                    const edit = bidderEdits[bidder.id] ?? {}
                    return (
                      <li key={bidder.id} className="rounded-md border border-slate-100 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-slate-800">{bidder.contractors?.name}</span>
                          <span className="text-xs text-slate-500">{formatDateTime(bidder.submitted_at)}</span>
                        </div>
                        <div className="mt-2 grid gap-3 sm:grid-cols-3">
                          <Field label="Bid Amount">{formatCurrency(bidder.bid_amount)}</Field>
                          <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Bid Status</p>
                            <select
                              value={edit.bid_status ?? bidder.bid_status}
                              onChange={(event) => updateBidderEdit(bidder.id, 'bid_status', event.target.value)}
                              className={`${inputClass} mt-0.5`}
                            >
                              {Object.entries(BID_STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <Field label="Evaluated By">{bidder.evaluator?.full_name}</Field>
                        </div>
                        <div className="mt-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                            Evaluation Notes
                          </p>
                          <textarea
                            rows={2}
                            value={edit.evaluation_notes ?? bidder.evaluation_notes ?? ''}
                            onChange={(event) => updateBidderEdit(bidder.id, 'evaluation_notes', event.target.value)}
                            className={`${textareaClass} mt-0.5`}
                          />
                        </div>
                        <div className="mt-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            loading={savingBidderId === bidder.id}
                            disabled={!bidderEdits[bidder.id]}
                            onClick={() => handleSaveBidderEvaluation(bidder)}
                          >
                            Save Evaluation
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              <form
                onSubmit={handleAddBidder}
                className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"
              >
                <div>
                  <label htmlFor="bidder_contractor" className="mb-1 block text-sm font-medium text-slate-700">
                    Contractor
                  </label>
                  <select
                    id="bidder_contractor"
                    value={bidderForm.contractor_id}
                    onChange={(event) =>
                      setBidderForm((f) => ({ ...f, contractor_id: event.target.value, newContractorName: '' }))
                    }
                    className={inputClass}
                  >
                    <option value="">Select existing contractor</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="bidder_new" className="mb-1 block text-sm font-medium text-slate-700">
                    Or New Contractor Name
                  </label>
                  <input
                    id="bidder_new"
                    value={bidderForm.newContractorName}
                    onChange={(event) =>
                      setBidderForm((f) => ({ ...f, newContractorName: event.target.value, contractor_id: '' }))
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="bidder_amount" className="mb-1 block text-sm font-medium text-slate-700">
                    Bid Amount
                  </label>
                  <input
                    id="bidder_amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={bidderForm.bid_amount}
                    onChange={(event) => setBidderForm((f) => ({ ...f, bid_amount: event.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" variant="secondary" size="sm" icon={UserPlus} loading={addingBidder}>
                    Add Bidder
                  </Button>
                </div>
              </form>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-800">Award &amp; Contract</h2>

              <div className="mt-4 flex flex-wrap items-end gap-3">
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
                    {bidders.map((bidder) => (
                      <option key={bidder.contractor_id} value={bidder.contractor_id}>
                        {bidder.contractors?.name}
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
                {procurement.contractors?.name ? (
                  <span className="text-sm text-slate-600">
                    Current awardee: <strong>{procurement.contractors.name}</strong>
                  </span>
                ) : null}
              </div>

              {procurement.contractor_id ? (
                <form onSubmit={handleSaveContract} className="mt-5 border-t border-slate-100 pt-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label htmlFor="contract_number" className="mb-1 block text-sm font-medium text-slate-700">
                        Contract Number
                      </label>
                      <input
                        id="contract_number"
                        value={contractForm.contract_number}
                        onChange={(event) => setContractForm((f) => ({ ...f, contract_number: event.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="contract_amount" className="mb-1 block text-sm font-medium text-slate-700">
                        Contract Amount
                      </label>
                      <input
                        id="contract_amount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={contractForm.contract_amount}
                        onChange={(event) => setContractForm((f) => ({ ...f, contract_amount: event.target.value }))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="contract_signed_date" className="mb-1 block text-sm font-medium text-slate-700">
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
                        onChange={(event) =>
                          setContractForm((f) => ({ ...f, notice_to_proceed_date: event.target.value }))
                        }
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
                        onChange={(event) =>
                          setContractForm((f) => ({ ...f, contract_duration_days: event.target.value }))
                        }
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="expected_completion" className="mb-1 block text-sm font-medium text-slate-700">
                        Expected Completion Date
                      </label>
                      <input
                        id="expected_completion"
                        type="date"
                        value={contractForm.expected_completion_date}
                        onChange={(event) =>
                          setContractForm((f) => ({ ...f, expected_completion_date: event.target.value }))
                        }
                        className={inputClass}
                      />
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
                    {procurement.status === 'CONTRACT_SIGNED' ? (
                      <Button type="button" variant="secondary" size="sm" onClick={handleMarkCompleted}>
                        Mark Procurement Completed
                      </Button>
                    ) : null}
                  </div>
                </form>
              ) : null}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5">
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
                className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"
              >
                <div>
                  <label htmlFor="doc_category" className="mb-1 block text-sm font-medium text-slate-700">
                    Category
                  </label>
                  <select
                    id="doc_category"
                    value={docForm.category}
                    onChange={(event) => setDocForm((f) => ({ ...f, category: event.target.value }))}
                    className={inputClass}
                  >
                    {Object.entries(PROCUREMENT_DOC_CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="doc_title" className="mb-1 block text-sm font-medium text-slate-700">
                    Title (optional)
                  </label>
                  <input
                    id="doc_title"
                    value={docForm.title}
                    onChange={(event) => setDocForm((f) => ({ ...f, title: event.target.value }))}
                    className={inputClass}
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
                    className="block w-full text-sm text-slate-600"
                  />
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" variant="secondary" size="sm" icon={Upload} loading={uploadingDoc}>
                    Upload
                  </Button>
                </div>
              </form>
            </section>
          </>
        )}

        {pastCycles.length > 0 ? (
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-800">Past Procurement Cycles</h2>
            <ul className="mt-4 space-y-3">
              {pastCycles.map((cycle) => (
                <li key={cycle.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={PROCUREMENT_STATUS_TONES[cycle.status]}>
                      {PROCUREMENT_STATUS_LABELS[cycle.status] ?? cycle.status}
                    </Badge>
                    <span className="text-xs text-slate-500">{formatDateTime(cycle.created_at)}</span>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <Field label="Mode">{cycle.mode_of_procurement}</Field>
                    <Field label="ABC">{formatCurrency(cycle.abc_amount)}</Field>
                    <Field label="Contractor">{cycle.contractors?.name}</Field>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  )
}
