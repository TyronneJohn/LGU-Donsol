import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary: 'bg-blue-700 text-white hover:bg-blue-800 focus-visible:ring-blue-600',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-blue-600',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-blue-600',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
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
  const classes = `inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`

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
