export function formatCurrency(value) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Short "time ago" label for conversation/notification lists — falls back
// to a plain date once it's more than a week old rather than growing an
// ever-longer "N weeks ago" string.
export function formatRelativeTime(value) {
  if (!value) return '—'
  const then = new Date(value).getTime()
  const diffMs = Date.now() - then
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) return 'Just now'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`
  if (diffMs < 2 * day) return 'Yesterday'
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`
  return formatDate(value)
}
