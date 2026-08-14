import { BarChart3, PieChart as PieChartIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from '../../utils/projectStatus'

// Matches the Badge tone palette, pulled from the brand blue/gold scale in
// index.css so charts read as part of the same system instead of Recharts'
// defaults.
const TONE_HEX = {
  neutral: '#94a3b8',
  blue: '#2c58ae',
  green: '#0d9488',
  amber: '#eea325',
  red: '#dc4c4c',
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-xl shadow-slate-900/10 backdrop-blur-sm">
      <p className="font-medium text-slate-700">{name}</p>
      <p className="text-slate-500">
        {value} project{value === 1 ? '' : 's'}
      </p>
    </div>
  )
}

function AngledTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={10}
        textAnchor="end"
        fill="#475569"
        fontSize={11}
        transform="rotate(-35)"
      >
        {payload.value}
      </text>
    </g>
  )
}

// Shared status-breakdown visualization used on every office dashboard
// (Admin/MPDC/Engineering/BAC). `counts` is a plain { STATUS_KEY: number }
// tally — each dashboard builds it from whatever `projects` rows it already
// fetched, so this component stays presentation-only.
export function ProjectStatusCharts({ counts, title = 'Projects by Status' }) {
  const data = Object.entries(PROJECT_STATUS_LABELS)
    .map(([key, label]) => ({
      key,
      name: label,
      value: counts?.[key] ?? 0,
      tone: PROJECT_STATUS_TONES[key],
    }))
    .filter((row) => row.value > 0)

  const total = data.reduce((sum, row) => sum + row.value, 0)

  if (total === 0) return null

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-5">
      <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5 lg:col-span-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 className="font-display text-sm font-semibold text-slate-800">{title}</h2>
        </div>
        <div className="mt-4 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 48, left: 0 }} barCategoryGap="28%">
              <defs>
                {data.map((row) => {
                  const hex = TONE_HEX[row.tone] ?? TONE_HEX.blue
                  return (
                    <linearGradient key={row.key} id={`bar-${row.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={hex} stopOpacity={1} />
                      <stop offset="100%" stopColor={hex} stopOpacity={0.55} />
                    </linearGradient>
                  )
                })}
              </defs>
              <CartesianGrid vertical={false} stroke="#eef2f7" />
              <XAxis
                dataKey="name"
                interval={0}
                tick={<AngledTick />}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#eef3fb' }} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={46}>
                {data.map((row) => (
                  <Cell key={row.key} fill={`url(#bar-${row.key})`} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/70 bg-white shadow-sm shadow-slate-200/60 p-5 lg:col-span-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold-50 text-gold-600">
            <PieChartIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 className="font-display text-sm font-semibold text-slate-800">Status Mix</h2>
        </div>
        <div className="relative mt-1 h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <defs>
                <filter id="donut-shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.15" />
                </filter>
              </defs>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="62%"
                outerRadius="88%"
                paddingAngle={3}
                cornerRadius={6}
                filter="url(#donut-shadow)"
              >
                {data.map((row) => (
                  <Cell key={row.key} fill={TONE_HEX[row.tone] ?? TONE_HEX.blue} stroke="white" strokeWidth={2} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <p className="text-2xl font-semibold text-slate-800">{total}</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Total</p>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {data.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: TONE_HEX[row.tone] ?? TONE_HEX.blue }}
                  aria-hidden="true"
                />
                <span className="truncate">{row.name}</span>
              </span>
              <span className="shrink-0 font-medium text-slate-800">{row.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
          {total} total project{total === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  )
}
