import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Building2, FileWarning } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { useToast } from '../../hooks/useToast'
import PageHeader from '../../components/ui/PageHeader'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { LoadingState } from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { BID_STATUS_LABELS, BID_STATUS_TONES, PROCUREMENT_STATUS_LABELS, PROCUREMENT_STATUS_TONES } from '../../utils/projectStatus'

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-800">{children ?? '—'}</p>
    </div>
  )
}

export default function BacContractorDetail() {
  const { contractorId } = useParams()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [contractor, setContractor] = useState(null)
  const [bids, setBids] = useState([])
  const [awards, setAwards] = useState([])

  async function loadData() {
    setLoading(true)

    const { data: contractorData, error: contractorError } = await supabase
      .from('contractors')
      .select('id, name, business_address, contact_person, contact_number, email, license_number')
      .eq('id', contractorId)
      .maybeSingle()

    if (contractorError || !contractorData) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setContractor(contractorData)

    const [bidsResult, awardsResult] = await Promise.all([
      supabase
        .from('procurement_bidders')
        .select(
          `id, bid_amount, bid_status, submitted_at,
           procurement:procurement_id(id, status, projects(id, project_code, title))`,
        )
        .eq('contractor_id', contractorId)
        .order('submitted_at', { ascending: false }),
      supabase
        .from('procurement')
        .select(
          `id, status, contract_number, contract_amount, contract_signed_date, notice_to_proceed_date,
           expected_completion_date, is_current, projects(id, project_code, title)`,
        )
        .eq('contractor_id', contractorId)
        .order('created_at', { ascending: false }),
    ])

    if (bidsResult.error) toast.error('Could not load bid history', bidsResult.error.message)
    if (awardsResult.error) toast.error('Could not load award history', awardsResult.error.message)

    setBids(bidsResult.data ?? [])
    setAwards(awardsResult.data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [contractorId])

  if (loading) {
    return <LoadingState label="Loading contractor..." />
  }

  if (notFound) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Contractor not found"
        action={
          <Button variant="secondary" size="sm" to="/bac/contractors">
            Back to Contractors
          </Button>
        }
      />
    )
  }

  return (
    <div>
      <PageHeader
        title={contractor.name}
        description={contractor.license_number ? `License #${contractor.license_number}` : undefined}
        breadcrumbs={[
          { label: 'Dashboard', to: '/bac' },
          { label: 'Contractors', to: '/bac/contractors' },
          { label: contractor.name },
        ]}
      />

      <div className="space-y-6">
        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Contractor Details
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Business Address">{contractor.business_address}</Field>
            <Field label="Contact Person">{contractor.contact_person}</Field>
            <Field label="Contact Number">{contractor.contact_number}</Field>
            <Field label="Email">{contractor.email}</Field>
            <Field label="License Number">{contractor.license_number}</Field>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Bid History</h2>
          {bids.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No bids recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {bids.map((bid) => (
                <li key={bid.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {bid.procurement?.projects?.title ?? 'Unknown project'}
                    </span>
                    <span className="text-xs text-slate-500">{formatDateTime(bid.submitted_at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Badge tone={BID_STATUS_TONES[bid.bid_status]}>{BID_STATUS_LABELS[bid.bid_status]}</Badge>
                    <span className="text-sm text-slate-600">{formatCurrency(bid.bid_amount)}</span>
                    {bid.procurement?.projects?.project_code ? (
                      <Button variant="ghost" size="sm" to={`/bac/procurement/${bid.procurement.projects.id}`}>
                        Open Project
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
          <h2 className="text-sm font-semibold text-slate-800">Awards &amp; Contracts</h2>
          {awards.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No awards recorded yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {awards.map((award) => (
                <li key={award.id} className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800">
                      {award.projects?.title ?? 'Unknown project'} {award.is_current ? '' : '(past cycle)'}
                    </span>
                    <Badge tone={PROCUREMENT_STATUS_TONES[award.status]}>
                      {PROCUREMENT_STATUS_LABELS[award.status] ?? award.status}
                    </Badge>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Contract #">{award.contract_number}</Field>
                    <Field label="Contract Amount">{formatCurrency(award.contract_amount)}</Field>
                    <Field label="Signed">{formatDate(award.contract_signed_date)}</Field>
                    <Field label="Expected Completion">{formatDate(award.expected_completion_date)}</Field>
                  </div>
                  {award.projects?.id ? (
                    <div className="mt-2">
                      <Button variant="ghost" size="sm" to={`/bac/procurement/${award.projects.id}`}>
                        Open Project
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
