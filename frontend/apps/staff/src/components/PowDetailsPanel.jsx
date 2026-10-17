import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import PowBreakdown from '@shared/components/PowBreakdown'
import { useToast } from '../hooks/useToast'

// Loads and shows Engineering's detailed Program of Works for one project
// (project_pow_details). Used on MPDC's project page and both monitoring
// pages. Renders nothing for projects whose POW predates the detailed form.
export default function PowDetailsPanel({ projectId, powDate, defaultOpen = false }) {
  const toast = useToast()
  const [pow, setPow] = useState(null)
  const [open, setOpen] = useState(defaultOpen)

  useEffect(() => {
    if (!projectId) return undefined
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('project_pow_details')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle()
      if (cancelled) return
      if (error) toast.error('Could not load the Program of Works breakdown', error.message)
      setPow(data ?? null)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (!pow) return null

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 text-left text-sm font-semibold text-slate-900"
        aria-expanded={open}
      >
        Budget Breakdown, Materials, Manpower &amp; Equipment
        {open ? <ChevronUp className="h-4 w-4 text-slate-900" /> : <ChevronDown className="h-4 w-4 text-slate-900" />}
      </button>
      {open ? (
        <div className="mt-4">
          <PowBreakdown pow={{ ...pow, pow_date: powDate ?? null }} />
        </div>
      ) : null}
    </div>
  )
}
