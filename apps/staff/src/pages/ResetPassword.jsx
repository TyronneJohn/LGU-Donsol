import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import Button from '../components/ui/Button'
import donsolSeal from '@shared/assets/Donsol.png'

// Landing page for the link Supabase emails from resetPasswordForEmail()
// (triggered on the /login "Forgot password?" flow). Opening that link logs
// the browser into a short-lived recovery session automatically (Supabase
// JS detects the token in the URL) — this page just asks for a new password
// and calls updateUser() with that session, then signs out so the user
// re-authenticates normally with the new password.
export default function ResetPassword() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!done) return
    const timeout = setTimeout(() => navigate('/login', { replace: true }), 2000)
    return () => clearTimeout(timeout)
  }, [done, navigate])

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    await supabase.auth.signOut()
    setDone(true)
  }

  const hasRecoverySession = !loading && !!user

  return (
    <div className="brand-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div
        aria-hidden="true"
        className="animate-blob absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-500/40 blur-3xl sm:h-96 sm:w-96"
      />
      <div
        aria-hidden="true"
        className="animate-blob absolute -right-16 top-1/3 h-64 w-64 rounded-full bg-gold-400/30 blur-3xl sm:h-80 sm:w-80"
        style={{ animationDelay: '-6s' }}
      />

      <div className="glass-card animate-fade-in relative z-10 w-full max-w-sm rounded-3xl p-6 shadow-2xl shadow-blue-950/50 sm:p-10">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src={donsolSeal}
            alt="Bayan ng Donsol seal"
            className="h-16 w-16 rounded-full ring-2 ring-gold-400/70"
          />
          <h1 className="font-display mt-3 text-lg font-semibold text-slate-800">Set a new password</h1>
          <p className="text-sm text-slate-500">LGU Donsol Project Monitoring System</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-slate-500">Checking your reset link...</p>
        ) : done ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-emerald-50 px-4 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-700">Password updated</p>
            <p className="text-sm text-slate-500">Redirecting you to sign in...</p>
          </div>
        ) : !hasRecoverySession ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-500">
              This reset link is invalid or has expired. Request a new one from the login page.
            </p>
            <Button to="/login" variant="secondary" className="w-full">
              Back to login
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
                New password
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full rounded-lg border border-slate-300 bg-white/80 py-2.5 pl-10 pr-10 text-sm shadow-sm transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-slate-700">
                Confirm new password
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter password"
                  className="w-full rounded-lg border border-slate-300 bg-white/80 py-2.5 pl-10 pr-3 text-sm shadow-sm transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                />
              </div>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full shadow-lg shadow-blue-700/25" loading={submitting}>
              Update password
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
