import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { supabase } from '@shared/lib/supabaseClient'
import { useAuth } from '../hooks/useAuth'
import { ROLE_HOME_PATH } from '../utils/roles'
import Button from '../components/ui/Button'
import donsolSeal from '@shared/assets/Donsol.png'
import munisipyoPhoto from '../assets/Munisipyo.jpg'

const HIGHLIGHTS = [
  'Real-time project monitoring across every office',
  'Procurement, engineering, and planning in one place',
  'Role-based access, built around Donsol staff workflows',
]

export default function Login() {
  const navigate = useNavigate()
  const { user, role, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [justSignedIn, setJustSignedIn] = useState(false)

  const [mode, setMode] = useState('signin') // 'signin' | 'forgot'
  const [resetEmail, setResetEmail] = useState('')
  const [resetError, setResetError] = useState(null)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [resetSent, setResetSent] = useState(false)

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

  function openForgotPassword() {
    setResetEmail(email)
    setResetError(null)
    setResetSent(false)
    setMode('forgot')
  }

  function backToSignIn() {
    setMode('signin')
    setResetError(null)
  }

  async function handleResetRequest(event) {
    event.preventDefault()
    setResetError(null)
    setResetSubmitting(true)

    const { error: resetErrorResult } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setResetSubmitting(false)

    if (resetErrorResult) {
      setResetError(resetErrorResult.message)
      return
    }

    setResetSent(true)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${munisipyoPhoto})`, filter: 'grayscale(100%)' }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-linear-to-br from-slate-950/93 via-slate-800/85 to-slate-950/95"
      />
      <div
        aria-hidden="true"
        className="animate-blob absolute -left-24 -top-24 h-72 w-72 rounded-full bg-slate-400/30 blur-3xl sm:h-96 sm:w-96"
      />
      <div
        aria-hidden="true"
        className="animate-blob absolute -right-16 top-1/3 h-64 w-64 rounded-full bg-gold-400/25 blur-3xl sm:h-80 sm:w-80"
        style={{ animationDelay: '-6s' }}
      />
      <div
        aria-hidden="true"
        className="animate-blob absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-slate-500/35 blur-3xl sm:h-96 sm:w-96"
        style={{ animationDelay: '-11s' }}
      />

      <div className="animate-fade-in relative z-10 grid w-full max-w-4xl overflow-hidden rounded-3xl shadow-2xl shadow-blue-950/50 lg:grid-cols-2">
        {/* Brand panel — hidden on small screens to keep the form the focus there */}
        <div className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${munisipyoPhoto})` }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-br from-blue-800/90 via-blue-900/88 to-blue-950/92"
          />
          <div
            aria-hidden="true"
            className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gold-400/20 blur-2xl"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-16 -left-10 h-56 w-56 rounded-full bg-blue-400/20 blur-2xl"
          />

          <div className="relative">
            <div className="flex items-center gap-3">
              <img
                src={donsolSeal}
                alt="Bayan ng Donsol seal"
                className="h-14 w-14 rounded-full ring-2 ring-gold-400/80"
              />
              <div className="leading-tight">
                <p className="font-display text-lg font-semibold">Bayan ng Donsol</p>
                <p className="text-sm text-blue-200">Project Monitoring System</p>
              </div>
            </div>

            <h1 className="font-display mt-10 text-3xl font-bold leading-tight text-white">
              Track every project, office to office.
            </h1>
            <p className="mt-3 max-w-sm text-sm text-blue-200">
              A single, secure home for planning, engineering, procurement, and
              admin teams across the municipality.
            </p>
          </div>

          <ul className="relative mt-10 space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-blue-100">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Form panel */}
        <div className="glass-card relative flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <img
              src={donsolSeal}
              alt="Bayan ng Donsol seal"
              className="h-16 w-16 rounded-full ring-2 ring-gold-400/70"
            />
            <p className="font-display mt-3 text-base font-semibold text-slate-800">
              Bayan ng Donsol
            </p>
            <p className="text-sm text-slate-500">Project Monitoring System</p>
          </div>

          <div className="mb-6 hidden lg:block">
            <h2 className="font-display text-xl font-semibold text-slate-800">
              {mode === 'signin' ? 'Login' : 'Reset your password'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'signin'
                ? 'Sign in with your office credentials.'
                : "Enter your email and we'll send you a reset link."}
            </p>
          </div>

          {mode === 'signin' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="juandelacruz@gmail.com"
                    className="w-full rounded-lg border border-slate-300 bg-white/80 py-2.5 pl-10 pr-3 text-sm shadow-sm transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={openForgotPassword}
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
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

              {error ? (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full shadow-lg shadow-blue-700/25" loading={submitting}>
                Sign in
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              {resetSent ? (
                <div className="flex flex-col items-center gap-2 rounded-lg bg-emerald-50 px-4 py-6 text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden="true" />
                  <p className="text-sm font-medium text-slate-700">Check your email</p>
                  <p className="text-sm text-slate-500">
                    If an account exists for <span className="font-medium">{resetEmail}</span>, we've sent a link to
                    reset your password.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleResetRequest} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="mb-1 block text-sm font-medium text-slate-700">
                      Email
                    </label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                      <input
                        id="reset-email"
                        type="email"
                        autoComplete="email"
                        required
                        value={resetEmail}
                        onChange={(event) => setResetEmail(event.target.value)}
                        placeholder="juandelacruz@gmail.com"
                        className="w-full rounded-lg border border-slate-300 bg-white/80 py-2.5 pl-10 pr-3 text-sm shadow-sm transition-colors focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                      />
                    </div>
                  </div>

                  {resetError ? (
                    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                      {resetError}
                    </p>
                  ) : null}

                  <Button type="submit" className="w-full shadow-lg shadow-blue-700/25" loading={resetSubmitting}>
                    Send reset link
                  </Button>
                </form>
              )}

              <button
                type="button"
                onClick={backToSignIn}
                className="flex w-full items-center justify-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to sign in
              </button>
            </div>
          )}

          <p className="mt-8 text-center text-xs text-slate-400">
            LGU Donsol staff access only. Contact your office admin for an account.
          </p>
        </div>
      </div>
    </div>
  )
}
