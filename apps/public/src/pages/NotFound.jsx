import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <p className="text-3xl font-semibold text-slate-800">404</p>
      <p className="text-sm text-slate-500">This page could not be found.</p>
      <Link
        to="/"
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
      >
        Back to home
      </Link>
    </div>
  )
}
