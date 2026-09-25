import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary:
    'bg-linear-to-r from-blue-700 to-blue-600 text-white shadow-sm shadow-blue-700/30 hover:from-blue-800 hover:to-blue-700 hover:shadow-md hover:shadow-blue-700/30 focus-visible:ring-blue-600',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-blue-600',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-blue-600',
  danger:
    'bg-linear-to-r from-red-600 to-red-500 text-white shadow-sm shadow-red-600/30 hover:from-red-700 hover:to-red-600 focus-visible:ring-red-600',
}

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

// Polymorphic button: pass `to` for an internal Link, `href` for a plain
// anchor, or nothing for a real <button>. Keeps focus rings, disabled and
// loading styling consistent everywhere instead of every page hand-rolling
// its own button markup.
const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    to,
    href,
    icon: Icon,
    loading = false,
    disabled = false,
    className = '',
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const classes = `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`

  const content = (
    <>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : Icon ? (
        <Icon className="h-4 w-4" aria-hidden="true" />
      ) : null}
      {children}
    </>
  )

  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} {...props}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a ref={ref} href={href} className={classes} {...props}>
        {content}
      </a>
    )
  }

  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} {...props}>
      {content}
    </button>
  )
})

export default Button
