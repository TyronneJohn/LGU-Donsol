import { ShieldAlert } from 'lucide-react'
import Button from '../components/ui/Button'

export default function Unauthorized() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <ShieldAlert className="h-10 w-10 text-amber-600" aria-hidden="true" />
      <h1 className="text-lg font-semibold text-slate-800">
        You don't have access to this page
      </h1>
      <p className="max-w-sm text-sm text-slate-500">
        Your account role does not have permission to view this section.
        Contact an administrator if you believe this is a mistake.
      </p>
      <Button to="/" className="mt-2">
        Back to public site
      </Button>
    </div>
  )
}
