import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { UserCheck, X } from 'lucide-react'
import Button from './ui/Button'
import FieldError from './ui/FieldError'
import { invalidClass } from '../utils/fieldStyles'

const inputClass =
  'w-full rounded-md border border-slate-400 dark:border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

// Asks for the real name of the person doing an action ("Taken by" before
// the camera opens, "Responsible person" before a monitoring update is
// submitted). Office accounts are shared, so the name is what the
// Confirmed By record (useConfirmedBy) stores. Pre-filled with the last name
// used on the page. Render it only while open so the field resets each time.
export default function ConfirmNameDialog({
  title,
  description,
  label = 'Your Full Name',
  confirmLabel = 'Continue',
  confirmIcon,
  initialName = '',
  onConfirm,
  onCancel,
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState('')

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onCancel])

  function handleSubmit(event) {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      setError('Enter your full name.')
      return
    }
    onConfirm(trimmed)
  }

  return createPortal(
    <div className="fixed inset-0 z-1100 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-name-title"
        onSubmit={handleSubmit}
        className="animate-pop-in relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="confirm-name-title" className="flex items-center gap-2 text-base font-semibold text-slate-800">
            <UserCheck className="h-4 w-4 text-blue-600" aria-hidden="true" />
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="-m-1 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}

        <div className="mt-4">
          <label htmlFor="confirm_name" className="mb-1 block text-sm font-medium text-slate-700">
            {label} *
          </label>
          <input
            id="confirm_name"
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError('')
            }}
            placeholder="e.g. Juan Dela Cruz"
            autoComplete="name"
            className={inputClass + invalidClass(error)}
          />
          <FieldError message={error} />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" icon={confirmIcon}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
