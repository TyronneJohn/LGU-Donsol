import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME_PATH } from '../utils/roles'
import Button from '../components/ui/Button'
import donsolSeal from '../assets/Donsol.png'

export default function Login() {
  const navigate = useNavigate()
  const { user, role, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [justSignedIn, setJustSignedIn] = useState(false)

  // Only redirect after a successful submit on this form — not merely
  // because a session already exists (e.g. revisiting /login while still
  // logged in from earlier). That keeps the login form visible until the
  // user actually signs in again. A role-less account has nowhere to go.
  useEffect(() => {
    if (!justSignedIn || loading || !user) return
    navigate(role ? ROLE_HOME_PATH[role] : '/unauthorized', { replace: true })
  }, [justSignedIn, user, role, loading, navigate])

  async function handleSubmit(event) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setSubmitting(false)

    if (signInError) {
      setError(signInError.message)
      return
    }

    setJustSignedIn(true)
    // On success the useEffect above handles redirecting once the
    // AuthContext session/role updates.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
        <div className="h-1.5 bg-linear-to-r from-blue-800 via-blue-700 to-gold-500" />
        <div className="p-6">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className="h-16 w-16 rounded-full ring-2 ring-gold-400/70"
            />
            <h1 className="mt-3 text-lg font-semibold text-slate-800">
              Staff Login
            </h1>
            <p className="text-sm text-slate-500">
              LGU Donsol Project Monitoring System
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" loading={submitting}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
