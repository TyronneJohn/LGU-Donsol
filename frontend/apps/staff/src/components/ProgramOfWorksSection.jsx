import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useToast } from '../hooks/useToast'
import Button from './ui/Button'
import { formatCurrency, formatDate } from '@shared/utils/format'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'

// The Program of Works is what Engineering's accomplishment percentage is
// computed against — its line items are the breakdown of what is done and
// what is still pending. Surfaced on both monitoring pages so MPDC (and
// Engineering itself) can go straight from a reported percentage to the
// document behind it. Reads project_documents under pdocs_select_staff, so
// any staff role can open it; the POW itself is uploaded in
// engineering/ProjectReviewDetail.jsx.
async function openDocument(doc, toast) {
  const { data, error } = await supabase.storage
    .from('project-documents')
    .createSignedUrl(doc.storage_path, 300)

  if (error || !data?.signedUrl) {
    toast.error('Could not open document', error?.message ?? 'Try again.')
    return
  }
  window.open(getDocumentViewUrl(data.signedUrl, doc.file_name), '_blank', 'noopener,noreferrer')
}

// The POW submitted with one monitoring update, shown on that update's entry
// in Monitoring History. `documents` is the update's embedded
// project_documents rows (linked by project_update_id); renders nothing for
// updates that predate the link.
export function UpdatePowButton({ documents }) {
  const toast = useToast()
  const [openingId, setOpeningId] = useState(null)

  const powDocuments = (documents ?? []).filter((doc) => doc.document_category === 'PROGRAM_OF_WORKS')
  if (powDocuments.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {powDocuments.map((doc) => (
        <Button
          key={doc.id}
          type="button"
          variant="secondary"
          size="sm"
          icon={FileText}
          loading={openingId === doc.id}
          onClick={async () => {
            setOpeningId(doc.id)
            await openDocument(doc, toast)
            setOpeningId(null)
          }}
        >
          {powDocuments.length === 1 ? 'View POW' : `View POW — ${doc.file_name}`}
        </Button>
      ))}
    </div>
  )
}

export default function ProgramOfWorksSection({ project }) {
  const toast = useToast()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [openingId, setOpeningId] = useState(null)

  useEffect(() => {
    if (!project?.id) return

    async function loadDocuments() {
      setLoading(true)
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, title, file_name, storage_path, created_at')
        .eq('project_id', project.id)
        .eq('document_category', 'PROGRAM_OF_WORKS')
        .order('created_at', { ascending: false })

      if (error) {
        toast.error('Could not load the Program of Works', error.message)
      } else {
        setDocuments(data ?? [])
      }
      setLoading(false)
    }
    loadDocuments()
  }, [project?.id])

  async function handleView(doc) {
    setOpeningId(doc.id)
    await openDocument(doc, toast)
    setOpeningId(null)
  }

  const [latest, ...older] = documents

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Program of Works</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Basis of the reported progress — lists the scope of work items completed and still pending.
          </p>
        </div>
        {latest ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={FileText}
            loading={openingId === latest.id}
            onClick={() => handleView(latest)}
          >
            View Program of Works
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">POW Amount</p>
          <p className="mt-0.5 text-sm text-slate-800">{formatCurrency(project.pow_amount)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">POW Date</p>
          <p className="mt-0.5 text-sm text-slate-800">{formatDate(project.pow_date)}</p>
        </div>
      </div>

      {!loading && !latest ? (
        <p className="mt-4 text-sm text-slate-400">No Program of Works document on file.</p>
      ) : null}

      {older.length > 0 ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Earlier versions</p>
          <ul className="mt-2 space-y-1">
            {older.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => handleView(doc)}
                  disabled={openingId === doc.id}
                  className="text-sm text-blue-600 hover:underline disabled:opacity-50"
                >
                  {doc.file_name}
                </button>
                <span className="ml-2 text-xs text-slate-400">{formatDate(doc.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
