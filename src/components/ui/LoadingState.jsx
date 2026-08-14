import { Loader2 } from 'lucide-react'

export function Spinner({ className = 'h-5 w-5' }) {
  return <Loader2 className={`${className} animate-spin text-blue-600`} aria-hidden="true" />
}

// Loading placeholder for route/page/panel-level fetches. `fullScreen` is
// for the pre-auth / pre-layout case (ProtectedRoute); otherwise it fills
// whatever content area it's placed in.
export function LoadingState({ label = 'Loading...', fullScreen = false }) {
  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 text-slate-500 ${
        fullScreen ? 'min-h-screen' : 'min-h-[240px] flex-1'
      }`}
    >
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

// Pulse block for future skeleton layouts (list rows, cards, etc.).
export function SkeletonBlock({ className = 'h-4 w-full' }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden="true" />
}
