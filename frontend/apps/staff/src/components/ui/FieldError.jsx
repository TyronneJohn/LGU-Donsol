import { AlertCircle } from 'lucide-react'

/** Inline warning shown under a required field that was left empty. */
export default function FieldError({ message }) {
  if (!message) return null
  return (
    <p role="alert" className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  )
}
