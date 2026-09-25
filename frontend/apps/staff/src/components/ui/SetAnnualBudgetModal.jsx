import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Button from './Button'
import CurrencyInput from './CurrencyInput'
import { useToast } from '../../hooks/useToast'

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'

// Admin-only: sets the Annual Budget ceiling for one fiscal year (see
// useAnnualBudget) — the appropriated amount every dashboard's "Remaining
// Budget" figure draws down against as projects are approved.
export default function SetAnnualBudgetModal({ open, year, currentAmount, onSave, onClose }) {
  const toast = useToast()
  const [amount, setAmount] = useState(currentAmount != null ? String(currentAmount) : '')
  const [saving, setSaving] = useState(false)

  if (!open) return null

  async function handleSubmit(event) {
    event.preventDefault()
    if (amount === '' || Number(amount) < 0) return

    setSaving(true)
    try {
      await onSave(Number(amount))
      toast.success('Annual Budget updated', `${year} ceiling saved.`)
      onClose()
    } catch (error) {
      toast.error('Could not save Annual Budget', error.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="Dismiss dialog"
        onClick={onClose}
        className="fixed inset-0 bg-blue-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="annual-budget-modal-title"
        className="animate-pop-in relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-900/5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="annual-budget-modal-title" className="text-base font-semibold text-slate-800">
            Annual Budget — {year}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="annual_budget_amount" className="mb-1 block text-sm font-medium text-slate-700">
            Appropriated amount for {year}
          </label>
          <CurrencyInput id="annual_budget_amount" value={amount} onChange={setAmount} className={inputClass} />
          <p className="mt-2 text-xs text-slate-500">
            Projects from Endorsed to BAC onward draw down against this ceiling on every office's dashboard.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={amount === ''}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
