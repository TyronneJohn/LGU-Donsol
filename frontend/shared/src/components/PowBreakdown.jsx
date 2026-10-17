import { formatDate } from '../utils/format'
import { formatNumber, formatPeso, scheduleTotals } from '../utils/programOfWorks'

// Read-only view of a detailed Program of Works (project_pow_details, or the
// 'program_of_works' object of get_public_project_transparency()). Shared by
// the staff pages and the public project page, so both show exactly the
// same breakdown of where the budget goes.

const COST_PARTS = [
  { key: 'direct_cost', label: 'Direct cost (works)', color: 'bg-blue-600' },
  { key: 'overhead_amount', label: 'Overhead, contingencies & misc.', color: 'bg-sky-400' },
  { key: 'profit_amount', label: "Contractor's profit", color: 'bg-amber-400' },
  { key: 'vat_amount', label: 'Value Added Tax', color: 'bg-slate-400' },
]

function Heading({ children }) {
  return <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{children}</h4>
}

function Info({ label, children }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm text-slate-700">{children || '—'}</p>
    </div>
  )
}

const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'
const td = 'px-2 py-1.5 align-top text-slate-700'
const num = 'tabular-nums text-right'

export default function PowBreakdown({ pow }) {
  if (!pow) return null

  const items = Array.isArray(pow.items) ? pow.items : []
  const periods = Array.isArray(pow.schedule_periods) ? pow.schedule_periods : []
  const materials = Array.isArray(pow.materials) ? pow.materials : []
  const manpower = Array.isArray(pow.manpower) ? pow.manpower : []
  const equipment = Array.isArray(pow.equipment) ? pow.equipment : []
  const total = Number(pow.total_cost) || 0
  const hasSchedule = periods.length > 0 && items.some((item) => (item.schedule ?? []).some((v) => Number(v) > 0))
  const schedule = hasSchedule ? scheduleTotals(items, periods.length) : null

  return (
    <div className="space-y-5 text-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Info label="Scope">{pow.scope_description}</Info>
        <Info label="Mode of Implementation">{pow.mode_of_implementation}</Info>
        <Info label="Duration">{pow.duration_days ? `${pow.duration_days} calendar days` : null}</Info>
        <Info label="Date Prepared">{pow.pow_date ? formatDate(pow.pow_date) : null}</Info>
      </div>

      <section>
        <Heading>Where the budget goes</Heading>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
          {COST_PARTS.map((part) => {
            const share = total > 0 ? (Number(pow[part.key]) / total) * 100 : 0
            return share > 0 ? <div key={part.key} className={part.color} style={{ width: `${share}%` }} title={part.label} /> : null
          })}
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {COST_PARTS.map((part) => (
            <li key={part.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${part.color}`} />
                {part.label}
              </span>
              <span className="tabular-nums text-slate-800">
                {formatPeso(pow[part.key])}
                <span className="text-slate-400">
                  {' '}
                  ({total > 0 ? ((Number(pow[part.key]) / total) * 100).toFixed(1) : '0.0'}%)
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
          <span>Total Estimated Project Cost (ABC)</span>
          <span className="tabular-nums">{formatPeso(total)}</span>
        </p>
      </section>

      <section>
        <Heading>Bill of Quantities</Heading>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Item</th>
                <th className={th}>Description</th>
                <th className={`${th} text-right`}>Qty</th>
                <th className={th}>Unit</th>
                <th className={`${th} text-right`}>Unit Cost</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={`${th} text-right`}>Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, index) => (
                <tr key={`${item.item_no ?? ''}-${index}`}>
                  <td className={`${td} whitespace-nowrap text-slate-500`}>{item.item_no || index + 1}</td>
                  <td className={td}>{item.description}</td>
                  <td className={`${td} ${num}`}>{formatNumber(item.quantity)}</td>
                  <td className={td}>{item.unit}</td>
                  <td className={`${td} ${num}`}>{formatPeso(item.unit_cost)}</td>
                  <td className={`${td} ${num} font-medium`}>{formatPeso(item.amount)}</td>
                  <td className={`${td} ${num}`}>{formatNumber(item.weight)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50/60">
              {[
                ['A. Total Estimated Direct Cost', pow.direct_cost],
                [`B. Overhead, Contingencies & Misc. (${formatNumber(pow.overhead_pct)}% of A)`, pow.overhead_amount],
                [`C. Contractor's Profit (${formatNumber(pow.profit_pct)}% of A)`, pow.profit_amount],
                [`D. Value Added Tax (${formatNumber(pow.vat_pct)}% of A+B+C)`, pow.vat_amount],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className={td} colSpan={5}>
                    {label}
                  </td>
                  <td className={`${td} ${num}`}>{formatPeso(value)}</td>
                  <td />
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={`${td} text-slate-800`} colSpan={5}>
                  Total Estimated Project Cost (ABC)
                </td>
                <td className={`${td} ${num} text-slate-800`}>{formatPeso(pow.total_cost)}</td>
                <td className={`${td} ${num}`}>100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {hasSchedule ? (
        <section>
          <Heading>Work Schedule and Weight of Activities</Heading>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Item</th>
                  <th className={`${th} text-right`}>Weight</th>
                  {periods.map((label, index) => (
                    <th key={index} className={`${th} text-right`}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, index) => (
                  <tr key={`${item.item_no ?? ''}-${index}`}>
                    <td className={`${td} whitespace-nowrap`} title={item.description}>
                      {item.item_no || item.description}
                    </td>
                    <td className={`${td} ${num}`}>{formatNumber(item.weight)}</td>
                    {periods.map((_, p) => {
                      const value = Number(item.schedule?.[p]) || 0
                      return (
                        <td key={p} className={`${td} ${num} ${value > 0 ? 'bg-blue-50 font-medium text-blue-800' : 'text-slate-300'}`}>
                          {value > 0 ? formatNumber(value) : '–'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50/60 font-medium">
                <tr>
                  <td className={td}>Period %</td>
                  <td className={`${td} ${num}`}>100.00</td>
                  {schedule.period.map((value, index) => (
                    <td key={index} className={`${td} ${num}`}>
                      {formatNumber(value)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className={td}>Cumulative %</td>
                  <td />
                  {schedule.cumulative.map((value, index) => (
                    <td key={index} className={`${td} ${num}`}>
                      {formatNumber(value)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <Heading>Major Materials</Heading>
          {materials.length > 0 ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {materials.map((material, index) => (
                <li key={index} className="flex justify-between gap-3 px-3 py-1.5 text-xs">
                  <span className="text-slate-700">
                    {material.name}
                    {material.remarks ? <span className="text-slate-400"> · {material.remarks}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-800">
                    {formatNumber(material.quantity)} {material.unit}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">None listed.</p>
          )}
        </section>

        <section className="space-y-4">
          <div>
            <Heading>Manpower</Heading>
            {manpower.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {manpower.map((person, index) => (
                  <li key={index} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                    {person.count} × {person.role}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">None listed.</p>
            )}
          </div>
          <div>
            <Heading>Equipment</Heading>
            {equipment.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {equipment.map((unit, index) => (
                  <li key={index} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                    {unit.count} × {unit.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">None listed.</p>
            )}
          </div>
        </section>
      </div>

      {pow.notes ? (
        <section>
          <Heading>Notes</Heading>
          <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{pow.notes}</p>
        </section>
      ) : null}
    </div>
  )
}
