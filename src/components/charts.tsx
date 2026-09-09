import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LineChart, Line,
} from 'recharts'
import { brl, brlShort, monthShort } from '@/lib/format'

/** Ordem fixa — nunca reciclada. A 9ª categoria vira "Outras". */
export const SERIES = [
  '#2a78d6', '#eb6834', '#1baf7a', '#eda100',
  '#e87ba4', '#008300', '#4a3aa7', '#e34948',
]
export const COLOR_RECEITA = '#2a78d6'
export const COLOR_DESPESA = '#e34948'

const GRID = '#e1e0d9'
const AXIS = '#c3c2b7'
const INK_MUTED = '#898781'

function TooltipBox({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-float">
      {label && <p className="mb-1 text-xs font-medium text-ink-soft">{label}</p>}
      {payload.map((p: any) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-ink-soft">{p.name}</span>
          <span className="tabnum ml-auto font-medium text-ink">{brl(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Rosca de despesas por categoria — legenda com valor e % ao lado. */
export function CategoryDonut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((a, b) => a + b.value, 0)
  if (!total) {
    return <div className="flex h-64 items-center justify-center text-sm text-ink-muted">Sem despesas no período</div>
  }
  const top = data.slice(0, 8)
  const rest = data.slice(8)
  const chartData = rest.length
    ? [...top, { name: 'Outras categorias', value: rest.reduce((a, b) => a + b.value, 0) }]
    : top

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={98}
              paddingAngle={1.5}
              stroke="#fcfcfb"
              strokeWidth={2}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="space-y-2 self-center">
        {chartData.map((d, i) => (
          <li key={d.name} className="flex items-center gap-3 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{d.name}</span>
            <span className="tabnum shrink-0 text-ink-muted">{brl(d.value)}</span>
            <span className="tabnum w-10 shrink-0 text-right font-semibold">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between border-t border-line pt-2 text-sm font-semibold">
          <span>Total</span>
          <span className="tabnum">{brl(total)}</span>
        </li>
      </ul>
    </div>
  )
}

/** Receitas vs despesas por categoria. */
export function CategoryBars({ data }: { data: { category: string; receitas: number; despesas: number }[] }) {
  if (!data.length) {
    return <div className="flex h-72 items-center justify-center text-sm text-ink-muted">Sem dados no período</div>
  }
  return (
    <div style={{ height: Math.max(280, data.length * 34 + 60) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 8, bottom: 8 }} barGap={2}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tickFormatter={brlShort} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: AXIS }} tickLine={false} />
          <YAxis
            type="category"
            dataKey="category"
            width={170}
            tick={{ fill: INK_MUTED, fontSize: 12 }}
            axisLine={{ stroke: AXIS }}
            tickLine={false}
          />
          <Tooltip content={<TooltipBox />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: INK_MUTED }} />
          <Bar dataKey="receitas" name="Receitas" fill={COLOR_RECEITA} radius={[0, 4, 4, 0]} maxBarSize={14} />
          <Bar dataKey="despesas" name="Despesas" fill={COLOR_DESPESA} radius={[0, 4, 4, 0]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Série mensal de receitas e despesas. */
export function MonthlyTrend({ data }: { data: { month: string; receitas: number; despesas: number }[] }) {
  if (!data.length) {
    return <div className="flex h-64 items-center justify-center text-sm text-ink-muted">Sem histórico</div>
  }
  const rows = data.map((d) => ({ ...d, label: monthShort(d.month) }))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={{ stroke: AXIS }} tickLine={false} />
          <YAxis tickFormatter={brlShort} tick={{ fill: INK_MUTED, fontSize: 12 }} axisLine={false} tickLine={false} width={64} />
          <Tooltip content={<TooltipBox />} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: INK_MUTED }} />
          <Line type="monotone" dataKey="receitas" name="Receitas" stroke={COLOR_RECEITA} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="despesas" name="Despesas" stroke={COLOR_DESPESA} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
