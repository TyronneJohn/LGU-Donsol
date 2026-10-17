// Program of Works arithmetic, shared by Engineering's entry form (live
// preview) and every place the breakdown is shown. Same rounding as
// submit_program_of_works() (20261017100000_program_of_works_details.sql),
// which recomputes and stores the authoritative totals.

export const DEFAULT_OVERHEAD_PCT = 8
export const DEFAULT_PROFIT_PCT = 8
export const DEFAULT_VAT_PCT = 5

// Pesos with centavos — a POW is read line by line, so formatCurrency's
// whole-peso rounding would make the items not add up on screen.
export function formatPeso(value) {
  if (value === null || value === undefined || value === '') return '—'
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 }).format(value)
}

export function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  return new Intl.NumberFormat('en-PH', { maximumFractionDigits: digits }).format(value)
}

const round2 =(value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100

export function itemAmount(item) {
  const quantity = Number(item.quantity)
  const unitCost = Number(item.unit_cost)
  if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return 0
  return round2(quantity * unitCost)
}

// { items: [{...item, amount, weight}], direct, overhead, profit, vat, indirect, total }
export function computePowTotals({ items = [], overhead_pct = 0, profit_pct = 0, vat_pct = 0 }) {
  const withAmounts = items.map((item) => ({ ...item, amount: itemAmount(item) }))
  const direct = round2(withAmounts.reduce((sum, item) => sum + item.amount, 0))
  const overhead = round2((direct * Number(overhead_pct || 0)) / 100)
  const profit = round2((direct * Number(profit_pct || 0)) / 100)
  const vat = round2(((direct + overhead + profit) * Number(vat_pct || 0)) / 100)
  const indirect = round2(overhead + profit + vat)
  return {
    items: withAmounts.map((item) => ({ ...item, weight: direct > 0 ? round2((item.amount / direct) * 100) : 0 })),
    direct,
    overhead,
    profit,
    vat,
    indirect,
    total: round2(direct + indirect),
  }
}

// Period totals and running cumulative % of the work schedule.
export function scheduleTotals(items, periodCount) {
  const period = Array.from({ length: periodCount }, (_, index) =>
    round2(items.reduce((sum, item) => sum + (Number(item.schedule?.[index]) || 0), 0)),
  )
  let running = 0
  const cumulative = period.map((value) => {
    running = round2(running + value)
    return running
  })
  return { period, cumulative }
}
