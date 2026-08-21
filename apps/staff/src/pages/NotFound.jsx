import Button from '../components/ui/Button'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <p className="text-3xl font-semibold text-slate-800">404</p>
      <p className="text-sm text-slate-500">This page could not be found.</p>
      <Button to="/login" className="mt-2">
        Back to login
      </Button>
    </div>
  )
}
