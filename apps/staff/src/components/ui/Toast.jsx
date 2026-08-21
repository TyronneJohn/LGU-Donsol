import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

const STYLES = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    iconClassName: 'text-emerald-600',
  },
  error: {
    icon: XCircle,
    className: 'border-red-200 bg-red-50 text-red-800',
    iconClassName: 'text-red-600',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    iconClassName: 'text-amber-600',
  },
  info: {
    icon: Info,
    className: 'border-blue-200 bg-blue-50 text-blue-800',
    iconClassName: 'text-blue-600',
  },
}

export default function ToastViewport({ toasts, onDismiss }) {
  if (toasts.length === 0) return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const config = STYLES[toast.type] ?? STYLES.info
        const Icon = config.icon
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 shadow-md ${config.className}`}
          >
            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${config.iconClassName}`} aria-hidden="true" />
            <div className="flex-1 text-sm">
              <p className="font-medium">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 opacity-90">{toast.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 hover:bg-black/5"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
