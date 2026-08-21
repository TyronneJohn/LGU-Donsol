import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import Button from './Button'

// Presentational confirmation modal. Most call sites should reach for the
// useConfirm() hook (ConfirmContext) instead of rendering this directly —
// it wires open/resolve state so a destructive action can just
// `await confirm({...})` instead of managing its own dialog state.
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    confirmRef.current?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') onCancel?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onCancel}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-description' : undefined}
        className="animate-pop-in relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="flex items-start gap-3">
          {tone === 'danger' ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50">
              <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
            </span>
          ) : null}
          <div>
            <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-800">
              {title}
            </h2>
            {description ? (
              <p id="confirm-dialog-description" className="mt-1 text-sm text-slate-500">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
