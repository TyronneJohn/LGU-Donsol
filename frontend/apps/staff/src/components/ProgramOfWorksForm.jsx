import { Plus, Trash2 } from 'lucide-react'
import Button from './ui/Button'
import {
  DEFAULT_OVERHEAD_PCT,
  DEFAULT_PROFIT_PCT,
  DEFAULT_VAT_PCT,
  computePowTotals,
  formatNumber,
  formatPeso,
  scheduleTotals,
} from '@shared/utils/programOfWorks'

// Engineering's detailed Program of Works entry (ProjectReviewDetail.jsx):
// general info, Bill of Quantities, cost summary percentages, work schedule,
// materials, manpower and equipment. Amounts, weights and totals are
// computed live here and recomputed by submit_program_of_works() on save.

const cell =
  'w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100'
const label = 'mb-1 block text-xs font-medium text-slate-700'
const th = 'px-1.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500'

const newKey = () => crypto.randomUUID()

export function emptyPowDetails() {
  return {
    scope_description: '',
    mode_of_implementation: 'By Contract (Public Bidding)',
    duration_days: '',
    items: [{ key: newKey(), item_no: '', description: '', quantity: '', unit: '', unit_cost: '', schedule: [] }],
    schedule_periods: [],
    overhead_pct: DEFAULT_OVERHEAD_PCT,
    profit_pct: DEFAULT_PROFIT_PCT,
    vat_pct: DEFAULT_VAT_PCT,
    materials: [{ key: newKey(), name: '', quantity: '', unit: '', remarks: '' }],
    manpower: [{ key: newKey(), role: '', count: '' }],
    equipment: [{ key: newKey(), name: '', count: '' }],
    notes: '',
  }
}

const str = (value) => (value === null || value === undefined ? '' : String(value))

// Maps extract-program-of-works output onto the form. Schedule rows are
// matched to items by item number.
export function powDetailsFromExtraction(extracted) {
  const scheduleByItem = new Map((extracted.schedule ?? []).map((row) => [str(row.item_no).trim(), row.values ?? []]))
  return {
    scope_description: str(extracted.scope_description),
    mode_of_implementation: str(extracted.mode_of_implementation),
    duration_days: extracted.duration_days ? str(extracted.duration_days) : '',
    items: (extracted.items ?? []).map((item) => ({
      key: newKey(),
      item_no: str(item.item_no),
      description: str(item.description),
      quantity: str(item.quantity),
      unit: str(item.unit),
      unit_cost: str(item.unit_cost),
      schedule: (scheduleByItem.get(str(item.item_no).trim()) ?? []).map((v) => (Number(v) ? str(v) : '')),
    })),
    schedule_periods: (extracted.schedule_periods ?? []).map(str),
    overhead_pct: extracted.overhead_pct ?? DEFAULT_OVERHEAD_PCT,
    profit_pct: extracted.profit_pct ?? DEFAULT_PROFIT_PCT,
    vat_pct: extracted.vat_pct ?? DEFAULT_VAT_PCT,
    materials: (extracted.materials ?? []).map((m) => ({
      key: newKey(),
      name: str(m.name),
      quantity: str(m.quantity),
      unit: str(m.unit),
      remarks: str(m.remarks),
    })),
    manpower: (extracted.manpower ?? []).map((m) => ({ key: newKey(), role: str(m.role), count: str(m.count) })),
    equipment: (extracted.equipment ?? []).map((e) => ({ key: newKey(), name: str(e.name), count: str(e.count) })),
    notes: str(extracted.notes),
  }
}

// Maps a saved project_pow_details row (or a returned revision's snapshot)
// back onto the form, so Engineering revises it instead of starting over.
export function powDetailsFromSaved(saved) {
  const rows = (list, map, empty) => (list?.length ? list.map((row) => ({ key: newKey(), ...map(row) })) : [{ key: newKey(), ...empty }])
  return {
    scope_description: str(saved.scope_description),
    mode_of_implementation: str(saved.mode_of_implementation),
    duration_days: str(saved.duration_days),
    items: rows(
      saved.items,
      (item) => ({
        item_no: str(item.item_no),
        description: str(item.description),
        quantity: str(item.quantity),
        unit: str(item.unit),
        unit_cost: str(item.unit_cost),
        schedule: (item.schedule ?? []).map((v) => (Number(v) ? str(v) : '')),
      }),
      { item_no: '', description: '', quantity: '', unit: '', unit_cost: '', schedule: [] },
    ),
    schedule_periods: (saved.schedule_periods ?? []).map(str),
    overhead_pct: saved.overhead_pct ?? DEFAULT_OVERHEAD_PCT,
    profit_pct: saved.profit_pct ?? DEFAULT_PROFIT_PCT,
    vat_pct: saved.vat_pct ?? DEFAULT_VAT_PCT,
    materials: rows(
      saved.materials,
      (m) => ({ name: str(m.name), quantity: str(m.quantity), unit: str(m.unit), remarks: str(m.remarks) }),
      { name: '', quantity: '', unit: '', remarks: '' },
    ),
    manpower: rows(saved.manpower, (m) => ({ role: str(m.role), count: str(m.count) }), { role: '', count: '' }),
    equipment: rows(saved.equipment, (e) => ({ name: str(e.name), count: str(e.count) }), { name: '', count: '' }),
    notes: str(saved.notes),
  }
}

const filled = (row, fields) => fields.some((field) => str(row[field]).trim() !== '')

// Problems that block "Send to MPDC", or [] when the POW is complete.
export function powDetailsProblems(details) {
  const problems = []
  const items = details.items.filter((row) => filled(row, ['item_no', 'description', 'quantity', 'unit', 'unit_cost']))
  if (items.length === 0) problems.push('Add at least one Bill of Quantities item.')
  if (items.some((row) => !str(row.description).trim() || !str(row.unit).trim() || !(Number(row.quantity) > 0) || row.unit_cost === '' || Number(row.unit_cost) < 0)) {
    problems.push('Every Bill of Quantities item needs a description, quantity, unit and unit cost.')
  }
  const materials = details.materials.filter((row) => filled(row, ['name', 'quantity', 'unit']))
  if (materials.length === 0) problems.push('List the major materials.')
  if (materials.some((row) => !str(row.name).trim() || !(Number(row.quantity) > 0) || !str(row.unit).trim())) {
    problems.push('Every material needs a name, quantity and unit.')
  }
  const manpower = details.manpower.filter((row) => filled(row, ['role', 'count']))
  if (manpower.length === 0) problems.push('List the manpower requirements.')
  if (manpower.some((row) => !str(row.role).trim() || !(Number(row.count) > 0))) {
    problems.push('Every manpower entry needs a role and a count.')
  }
  const equipment = details.equipment.filter((row) => filled(row, ['name', 'count']))
  if (equipment.some((row) => !str(row.name).trim() || !(Number(row.count) > 0))) {
    problems.push('Every equipment entry needs a name and a count.')
  }
  if (!str(details.scope_description).trim()) problems.push('Describe the scope (length, width, area).')
  if (!(Number(details.duration_days) > 0)) problems.push('Enter the duration in calendar days.')
  return problems
}

// The payload for submit_program_of_works(): blank rows dropped, numbers as numbers.
export function powDetailsPayload(details) {
  const periodCount = details.schedule_periods.length
  return {
    scope_description: details.scope_description.trim(),
    mode_of_implementation: details.mode_of_implementation.trim(),
    duration_days: Number(details.duration_days) || null,
    items: details.items
      .filter((row) => filled(row, ['item_no', 'description', 'quantity', 'unit', 'unit_cost']))
      .map((row) => ({
        item_no: row.item_no.trim(),
        description: row.description.trim(),
        quantity: Number(row.quantity),
        unit: row.unit.trim(),
        unit_cost: Number(row.unit_cost),
        schedule: Array.from({ length: periodCount }, (_, i) => Number(row.schedule?.[i]) || 0),
      })),
    schedule_periods: details.schedule_periods.map((p) => p.trim()),
    overhead_pct: Number(details.overhead_pct) || 0,
    profit_pct: Number(details.profit_pct) || 0,
    vat_pct: Number(details.vat_pct) || 0,
    materials: details.materials
      .filter((row) => filled(row, ['name', 'quantity', 'unit']))
      .map((row) => ({ name: row.name.trim(), quantity: Number(row.quantity), unit: row.unit.trim(), remarks: row.remarks.trim() })),
    manpower: details.manpower
      .filter((row) => filled(row, ['role', 'count']))
      .map((row) => ({ role: row.role.trim(), count: Number(row.count) })),
    equipment: details.equipment
      .filter((row) => filled(row, ['name', 'count']))
      .map((row) => ({ name: row.name.trim(), count: Number(row.count) })),
    notes: details.notes.trim(),
  }
}

function Section({ title, hint, action, children }) {
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
          {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function RemoveButton({ onClick, disabled, label: name }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Remove ${name}`}
      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}

export default function ProgramOfWorksForm({ value: details, onChange, disabled = false }) {
  const totals = computePowTotals(details)
  const periodCount = details.schedule_periods.length
  const schedule = scheduleTotals(details.items, periodCount)

  const set = (patch) => onChange({ ...details, ...patch })
  const setRow = (list, key, patch) =>
    set({ [list]: details[list].map((row) => (row.key === key ? { ...row, ...patch } : row)) })
  const addRow = (list, row) => set({ [list]: [...details[list], { key: newKey(), ...row }] })
  const removeRow = (list, key) => set({ [list]: details[list].filter((row) => row.key !== key) })

  const setSchedule = (key, index, raw) =>
    set({
      items: details.items.map((row) => {
        if (row.key !== key) return row
        const next = Array.from({ length: periodCount }, (_, i) => row.schedule?.[i] ?? '')
        next[index] = raw
        return { ...row, schedule: next }
      }),
    })

  const addPeriod = () =>
    set({ schedule_periods: [...details.schedule_periods, `Wk ${periodCount * 2 + 1}-${periodCount * 2 + 2}`] })
  const removePeriod = (index) =>
    set({
      schedule_periods: details.schedule_periods.filter((_, i) => i !== index),
      items: details.items.map((row) => ({ ...row, schedule: (row.schedule ?? []).filter((_, i) => i !== index) })),
    })

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <Section title="General Information">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label htmlFor="pow_scope" className={label}>
              Scope (length, width, area, thickness) *
            </label>
            <input
              id="pow_scope"
              value={details.scope_description}
              onChange={(e) => set({ scope_description: e.target.value })}
              placeholder="e.g. 200.00 lin.m x 4.00 m width (800 sq.m), 0.23 m PCCP"
              className={cell}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="pow_mode" className={label}>
              Mode of Implementation
            </label>
            <input id="pow_mode" value={details.mode_of_implementation} onChange={(e) => set({ mode_of_implementation: e.target.value })} className={cell} />
          </div>
          <div>
            <label htmlFor="pow_duration" className={label}>
              Duration (calendar days) *
            </label>
            <input
              id="pow_duration"
              type="number"
              min="1"
              value={details.duration_days}
              onChange={(e) => set({ duration_days: e.target.value })}
              className={cell}
            />
          </div>
        </div>
      </Section>

      <Section
        title="I. Bill of Quantities"
        hint="Amount = Qty × Unit Cost. Weight = the item's share of the direct cost (basis of progress)."
        action={
          <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => addRow('items', { item_no: '', description: '', quantity: '', unit: '', unit_cost: '', schedule: [] })}>
            Add Item
          </Button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className={`${th} w-20`}>Item No.</th>
                <th className={th}>Description</th>
                <th className={`${th} w-20`}>Qty</th>
                <th className={`${th} w-20`}>Unit</th>
                <th className={`${th} w-28`}>Unit Cost</th>
                <th className={`${th} w-32 text-right`}>Amount</th>
                <th className={`${th} w-16 text-right`}>Weight</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {details.items.map((row, index) => (
                <tr key={row.key}>
                  <td className="p-1"><input aria-label="Item number" value={row.item_no} onChange={(e) => setRow('items', row.key, { item_no: e.target.value })} className={cell} /></td>
                  <td className="p-1"><input aria-label="Description" value={row.description} onChange={(e) => setRow('items', row.key, { description: e.target.value })} className={cell} /></td>
                  <td className="p-1"><input aria-label="Quantity" type="number" min="0" step="any" value={row.quantity} onChange={(e) => setRow('items', row.key, { quantity: e.target.value })} className={cell} /></td>
                  <td className="p-1"><input aria-label="Unit" value={row.unit} onChange={(e) => setRow('items', row.key, { unit: e.target.value })} className={cell} /></td>
                  <td className="p-1"><input aria-label="Unit cost" type="number" min="0" step="any" value={row.unit_cost} onChange={(e) => setRow('items', row.key, { unit_cost: e.target.value })} className={cell} /></td>
                  <td className="p-1 text-right text-xs tabular-nums text-slate-800">{formatPeso(totals.items[index].amount)}</td>
                  <td className="p-1 text-right text-xs tabular-nums text-slate-500">{formatNumber(totals.items[index].weight)}%</td>
                  <td className="p-1"><RemoveButton label="item" disabled={details.items.length === 1} onClick={() => removeRow('items', row.key)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="II. Summary of Cost">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['overhead_pct', 'Overhead, Contingencies & Misc. (% of direct cost)'],
            ['profit_pct', "Contractor's Profit (% of direct cost)"],
            ['vat_pct', 'VAT (% of direct + overhead + profit)'],
          ].map(([field, text]) => (
            <div key={field}>
              <label htmlFor={`pow_${field}`} className={label}>{text}</label>
              <input id={`pow_${field}`} type="number" min="0" max="100" step="any" value={details[field]} onChange={(e) => set({ [field]: e.target.value })} className={cell} />
            </div>
          ))}
        </div>
        <dl className="mt-3 grid gap-1 rounded-md bg-slate-50 p-3 text-xs">
          {[
            ['A. Total Estimated Direct Cost', totals.direct],
            ['B. Overhead, Contingencies & Misc.', totals.overhead],
            ["C. Contractor's Profit", totals.profit],
            ['D. Value Added Tax', totals.vat],
          ].map(([text, amount]) => (
            <div key={text} className="flex justify-between gap-2">
              <dt className="text-slate-500">{text}</dt>
              <dd className="tabular-nums text-slate-800">{formatPeso(amount)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-2 border-t border-slate-200 pt-1 font-semibold">
            <dt className="text-slate-800">Total Estimated Project Cost (ABC)</dt>
            <dd className="tabular-nums text-slate-900">{formatPeso(totals.total)}</dd>
          </div>
        </dl>
      </Section>

      <Section
        title="III. Work Schedule and Weight of Activities"
        hint="Optional. Enter each item's % of the total work per period; each row should add up to the item's weight."
        action={
          <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={addPeriod}>
            Add Period
          </Button>
        }
      >
        {periodCount === 0 ? (
          <p className="text-xs text-slate-500">No schedule periods yet. Add a period (e.g. "Wk 1-2") to enter the schedule.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr>
                  <th className={th}>Item</th>
                  <th className={`${th} text-right`}>Weight</th>
                  {details.schedule_periods.map((period, index) => (
                    <th key={index} className="p-1">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`Period ${index + 1} label`}
                          value={period}
                          onChange={(e) => set({ schedule_periods: details.schedule_periods.map((p, i) => (i === index ? e.target.value : p)) })}
                          className={`${cell} min-w-16 font-semibold`}
                        />
                        <RemoveButton label="period" onClick={() => removePeriod(index)} />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {details.items.map((row, index) => {
                  const rowSum = Array.from({ length: periodCount }, (_, i) => Number(row.schedule?.[i]) || 0).reduce((a, b) => a + b, 0)
                  const off = rowSum > 0 && Math.abs(rowSum - totals.items[index].weight) > 0.05
                  return (
                    <tr key={row.key}>
                      <td className="p-1 text-xs text-slate-700">{row.item_no || row.description || `Item ${index + 1}`}</td>
                      <td className={`p-1 text-right text-xs tabular-nums ${off ? 'font-semibold text-amber-700' : 'text-slate-500'}`} title={off ? `Row adds up to ${formatNumber(rowSum)}%` : undefined}>
                        {formatNumber(totals.items[index].weight)}
                      </td>
                      {details.schedule_periods.map((_, p) => (
                        <td key={p} className="p-1">
                          <input aria-label={`Schedule ${p + 1}`} type="number" min="0" max="100" step="any" value={row.schedule?.[p] ?? ''} onChange={(e) => setSchedule(row.key, p, e.target.value)} className={cell} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="text-xs font-medium text-slate-700">
                  <td className="p-1">Period %</td>
                  <td />
                  {schedule.period.map((v, i) => <td key={i} className="p-1 text-right tabular-nums">{formatNumber(v)}</td>)}
                </tr>
                <tr className="text-xs font-medium text-slate-700">
                  <td className="p-1">Cumulative %</td>
                  <td />
                  {schedule.cumulative.map((v, i) => <td key={i} className="p-1 text-right tabular-nums">{formatNumber(v)}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="IV. Major Materials"
        action={
          <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => addRow('materials', { name: '', quantity: '', unit: '', remarks: '' })}>
            Add Material
          </Button>
        }
      >
        <div className="space-y-1.5">
          {details.materials.map((row) => (
            <div key={row.key} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-1.5 sm:grid-cols-[2fr_6rem_6rem_2fr_auto]">
              <input aria-label="Material" placeholder="Material (e.g. Portland Cement 40 kg)" value={row.name} onChange={(e) => setRow('materials', row.key, { name: e.target.value })} className={cell} />
              <input aria-label="Quantity" placeholder="Qty" type="number" min="0" step="any" value={row.quantity} onChange={(e) => setRow('materials', row.key, { quantity: e.target.value })} className={cell} />
              <input aria-label="Unit" placeholder="Unit" value={row.unit} onChange={(e) => setRow('materials', row.key, { unit: e.target.value })} className={cell} />
              <input aria-label="Remarks" placeholder="Remarks (optional)" value={row.remarks} onChange={(e) => setRow('materials', row.key, { remarks: e.target.value })} className={`${cell} hidden sm:block`} />
              <RemoveButton label="material" disabled={details.materials.length === 1} onClick={() => removeRow('materials', row.key)} />
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          ['manpower', 'V. Manpower', 'role', 'Role (e.g. Laborer)', 'Add Role'],
          ['equipment', 'Equipment', 'name', 'Equipment (e.g. Backhoe)', 'Add Equipment'],
        ].map(([list, title, field, placeholder, addLabel]) => (
          <Section
            key={list}
            title={title}
            action={
              <Button type="button" variant="secondary" size="sm" icon={Plus} onClick={() => addRow(list, { [field]: '', count: '' })}>
                {addLabel}
              </Button>
            }
          >
            <div className="space-y-1.5">
              {details[list].map((row) => (
                <div key={row.key} className="grid grid-cols-[1fr_5rem_auto] gap-1.5">
                  <input aria-label={placeholder} placeholder={placeholder} value={row[field]} onChange={(e) => setRow(list, row.key, { [field]: e.target.value })} className={cell} />
                  <input aria-label="Count" placeholder="No." type="number" min="0" step="1" value={row.count} onChange={(e) => setRow(list, row.key, { count: e.target.value })} className={cell} />
                  <RemoveButton label={list} disabled={details[list].length === 1} onClick={() => removeRow(list, row.key)} />
                </div>
              ))}
            </div>
          </Section>
        ))}
      </div>

      <Section title="VI. Notes">
        <textarea aria-label="Notes" rows={3} value={details.notes} onChange={(e) => set({ notes: e.target.value })} className={cell} />
      </Section>
    </fieldset>
  )
}
