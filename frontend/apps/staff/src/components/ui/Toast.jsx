import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'

// White card with a colored icon badge, accent bar and countdown bar.
// bg-white / text-slate-* / *-100 badges are remapped for dark mode in
// shared/src/styles/index.css, so no dark: twins are needed here.
const STYLES = {
  success: {
    icon: CheckCircle2,
    badgeClassName: 'bg-emerald-100 text-emerald-600',
    accentClassName: 'bg-emerald-500',
  },
  error: {
    icon: XCircle,
    badgeClassName: 'bg-red-100 text-red-600',
    accentClassName: 'bg-red-500',
  },
  warning: {
    icon: AlertTriangle,
    badgeClassName: 'bg-amber-100 text-amber-600',
    accentClassName: 'bg-amber-500',
  },
  info: {
    icon: Info,
    badgeClassName: 'bg-blue-100 text-blue-600',
    accentClassName: 'bg-blue-500',
  },
}

export default function ToastViewport({ toasts, onDismiss }) {
  if (toasts.length === 0) return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col gap-2.5"
    >
      {toasts.map((toast) => {
        const config = STYLES[toast.type] ?? STYLES.info
        const Icon = config.icon
        return (
          <div
            key={toast.id}
            className="pointer-events-auto relative flex animate-toast-in items-start gap-3 overflow-hidden rounded-xl bg-white py-3.5 pr-3 pl-4 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10"
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${config.accentClassName}`} aria-hidden="true" />
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${config.badgeClassName}`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5 text-sm">
              <p className="font-semibold text-slate-900">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-slate-600">{toast.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            {toast.duration ? (
              <span
                className={`absolute bottom-0 left-0 h-0.5 w-full origin-left opacity-60 ${config.accentClassName}`}
                style={{ animation: `toast-progress ${toast.duration}ms linear forwards` }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
