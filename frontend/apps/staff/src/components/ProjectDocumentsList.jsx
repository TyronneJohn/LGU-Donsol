import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { getDocumentViewUrl } from '@shared/utils/documentViewer'
import { formatDate } from '@shared/utils/format'
import { useToast } from '../hooks/useToast'
import Button from './ui/Button'

const DOC_CATEGORY_LABELS = {
  PROGRAM_OF_WORKS: 'Program of Works',
  PERMIT: 'Permit',
  DESIGN_PLAN: 'Design Plan',
  OTHER: 'Other',
}

// Read-only list of the files Engineering uploaded to a project (the
// Program of Works file plus any other technical documents), with a View
// button for each. project_documents and the project-documents bucket are
// both readable by every staff role (pdocs_select_staff /
// project_documents_storage_select_staff), so MPDC can open them directly.
export default function ProjectDocumentsList({ projectId }) {
  const toast = useToast()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('project_documents')
        .select('id, document_category, title, file_name, storage_path, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
      if (cancelled) return
      if (error) toast.error('Could not load documents', error.message)
      else setDocuments(data ?? [])
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  async function handleView(doc) {
    const { data, error } = await supabase.storage.from('project-documents').createSignedUrl(doc.storage_path, 300)
    if (error || !data?.signedUrl) {
      toast.error('Could not open document', error?.message ?? 'Try again.')
      return
    }
    window.open(getDocumentViewUrl(data.signedUrl, doc.file_name), '_blank', 'noopener,noreferrer')
  }

  return (
    <section className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5">
      <h2 className="text-sm font-semibold text-slate-800">Technical Documents</h2>
      <p className="mt-0.5 text-xs text-slate-400">Files uploaded by Engineering — view only.</p>

      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading documents...</p>
      ) : documents.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No documents uploaded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-start gap-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">{doc.title}</p>
                  <p className="text-xs text-slate-500">
                    {DOC_CATEGORY_LABELS[doc.document_category] ?? doc.document_category} · {formatDate(doc.created_at)}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => handleView(doc)}>
                View
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
