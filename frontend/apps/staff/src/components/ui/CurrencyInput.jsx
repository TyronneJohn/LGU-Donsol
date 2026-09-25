import { ChevronDown, ChevronUp } from 'lucide-react'

function formatWithCommas(rawValue) {
  if (rawValue === '' || rawValue == null) return ''
  const [intPart, decPart] = String(rawValue).split('.')
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas
}

// Strips thousands-separator commas back to a plain numeric string, e.g.
// "1,500,000.50" -> "1500000.50", so the rest of the form keeps storing
// (and validating/submitting) the same comma-free numeric string it always
// has. Returns null for a keystroke that wouldn't produce a valid (possibly
// still mid-typing, e.g. trailing ".") number, so the caller can just
// reject it instead of accepting garbage.
function parseTyped(displayValue) {
  const cleaned = displayValue.replace(/,/g, '')
  if (cleaned !== '' && !/^\d*\.?\d*$/.test(cleaned)) return null
  return stripLeadingZeros(cleaned)
}

// A plain <input type="number"> auto-corrects "05" to "5" as you type; a
// type="text" input (needed here for the comma formatting) doesn't, so
// typing 0 then another digit would otherwise just pile up as "05", "056",
// etc. instead of replacing the placeholder-ish leading zero. Only strips
// zeros that are followed by another digit — "0" alone and "0.5" (a
// leading zero before the decimal point) are left untouched.
function stripLeadingZeros(cleaned) {
  const [intPart, ...rest] = cleaned.split('.')
  const normalizedInt = intPart.replace(/^0+(?=\d)/, '')
  return rest.length > 0 ? `${normalizedInt}.${rest.join('.')}` : normalizedInt
}

/**
 * Comma-formatted numeric input (peso amounts, etc.) with its own up/down
 * step buttons that always move by a whole 1 — deliberately separate from
 * the browser's native <input type="number"> spinner, which would step by
 * this app's usual `step="0.01"` and can't show thousands separators at all
 * (a plain number input rejects literal commas in its value).
 *
 * @param {string} value - raw numeric string, no commas (same shape this
 *   app's forms already store numeric fields as — '' when empty)
 * @param {(value: string) => void} onChange
 */
export default function CurrencyInput({ id, value, onChange, placeholder, className = '' }) {
  function handleInputChange(event) {
    const parsed = parseTyped(event.target.value)
    if (parsed === null) return
    onChange(parsed)
  }

  function step(direction) {
    const current = value === '' ? 0 : Number(value)
    const next = Math.max(0, current + direction)
    onChange(String(next))
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">₱</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={formatWithCommas(value)}
        onChange={handleInputChange}
        placeholder={placeholder}
        className={`${className} pl-7 pr-7`}
      />
      <div className="absolute inset-y-0 right-1 flex flex-col justify-center">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(1)}
          aria-label="Increase by 1"
          className="flex h-4 w-5 items-center justify-center rounded-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronUp className="h-3 w-3" aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => step(-1)}
          aria-label="Decrease by 1"
          className="flex h-4 w-5 items-center justify-center rounded-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:pointer-events-none disabled:opacity-50"
        >
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
