import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import Badge from './Badge'
import { formatDateTime } from '../../utils/format'
import { getDssSeverityTone } from '../../utils/decisionSupport'

const SEVERITY_ICON = {
  CRITICAL: AlertOctagon,
  HIGH: AlertTriangle,
  MEDIUM: Info,
  LOW: ShieldCheck,
}

const SEVERITY_CARD_CLASS = {
  CRITICAL: 'border-red-300 bg-red-50',
  HIGH: 'border-red-200 bg-red-50/70',
  MEDIUM: 'border-amber-200 bg-amber-50',
  LOW: 'border-emerald-200 bg-emerald-50',
}

// Renders one evaluateProjectDss() decision (src/utils/decisionSupport.js).
// Shared by the Engineering, MPDC, and Admin monitoring detail pages so the
// decision/reason/action/office layout only exists once. Renders nothing
// for a project the DSS hasn't evaluated (pre-implementation statuses).
export default function DssPanel({ decision }) {
  if (!decision) return null

  const Icon = SEVERITY_ICON[decision.severity] ?? Info
  const cardClass = SEVERITY_CARD_CLASS[decision.severity] ?? 'border-slate-200 bg-slate-50'

  return (
    <section className={`rounded-lg border p-5 ${cardClass}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <Icon className="h-4 w-4" aria-hidden="true" />
        Decision Support System
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Decision</p>
          <p className="mt-1">
            <Badge tone={getDssSeverityTone(decision.severity)}>{decision.label}</Badge>
          </p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Priority</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-800">{decision.severity}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reason</p>
        <p className="mt-0.5 text-sm text-slate-700">{decision.reason}</p>
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">System-Determined Action</p>
        <p className="mt-0.5 text-sm text-slate-700">{decision.action}</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Responsible Office</p>
          <p className="mt-0.5 text-sm text-slate-700">{decision.responsibleOffice}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Last Evaluation</p>
          <p className="mt-0.5 text-sm text-slate-700">{formatDateTime(decision.evaluatedAt)}</p>
        </div>
      </div>

      {decision.supportingConditions?.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Supporting Conditions</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {decision.supportingConditions.map((code) => (
              <li key={code}>
                <Badge tone="neutral">{code.replace(/_/g, ' ')}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
