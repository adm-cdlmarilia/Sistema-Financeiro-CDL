import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Scale, CalendarClock } from 'lucide-react'
import { supabase, Account } from '@/lib/supabase'
import { brl, currentMonth, firstDayOfMonth, lastDayOfMonth, monthLabel } from '@/lib/format'
import { Card, CardHeader, Select, Skeleton } from '@/components/ui'
import { CategoryDonut, MonthlyTrend } from '@/components/charts'

type Range = 'month' | 'semester' | 'year'

function rangeDates(range: Range, ym: string) {
  const now = new Date()
  if (range === 'month') return { start: firstDayOfMonth(ym), end: lastDayOfMonth(ym) }
  if (range === 'year') return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }
  const half = now.getMonth() < 6 ? 1 : 2
  return half === 1
    ? { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-06-30` }
    : { start: `${now.getFullYear()}-07-01`, end: `${now.getFullYear()}-12-31` }
}

function Kpi({
  title, value, subtitle, icon: Icon, tone,
}: { title: string; value: string; subtitle: string; icon: any; tone: 'neutral' | 'up' | 'down' }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm text-ink-soft">{title}</p>
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: tone === 'up' ? '#eef5fd' : tone === 'down' ? '#fdeeee' : '#f4f4f1',
            color: tone === 'up' ? '#2a78d6' : tone === 'down' ? '#c23434' : '#52514e',
          }}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <p className="tabnum mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>
    </Card>
  )
}

export default function Dashboard() {
  const [range, setRange] = useState<Range>('month')
  const [ym, setYm] = useState(currentMonth())
  const [accountId, setAccountId] = useState<string>('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('name')
      if (error) throw error
      return data as Account[]
    },
  })

  const { data: months } = useQuery({
    queryKey: ['available-months'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('available_months')
      if (error) throw error
      return (data as { month: string }[]).map((m) => m.month.slice(0, 7))
    },
  })

  // abre no mês mais recente que tem lançamento — não adianta abrir no mês
  // atual se o último extrato importado é de outro mês
  const ajustou = useRef(false)
  useEffect(() => {
    if (ajustou.current || !months?.length) return
    if (!months.includes(ym)) setYm(months[0])
    ajustou.current = true
  }, [months, ym])

  const { start, end } = rangeDates(range, ym)
  const account = accountId || null

  const { data: summary, isLoading } = useQuery({
    queryKey: ['summary', start, end, account],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_summary', {
        p_start: start, p_end: end, p_account: account,
      })
      if (error) throw error
      return (data as any[])[0]
    },
  })

  const { data: breakdown } = useQuery({
    queryKey: ['breakdown', start, end, account],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('category_breakdown', {
        p_start: start, p_end: end, p_type: 'despesa', p_account: account,
      })
      if (error) throw error
      return (data as any[]).map((r) => ({ name: r.category, value: Number(r.despesas) }))
        .filter((r) => r.value > 0)
    },
  })

  const { data: series } = useQuery({
    queryKey: ['monthly-series', account],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('monthly_series', { p_months: 12, p_account: account })
      if (error) throw error
      return (data as any[]).map((r) => ({
        month: r.month, receitas: Number(r.receitas), despesas: Number(r.despesas),
      }))
    },
  })

  const periodLabel =
    range === 'month' ? monthLabel(firstDayOfMonth(ym))
    : range === 'semester' ? 'semestre atual'
    : 'ano atual'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard financeiro</h1>
          <p className="mt-1 text-sm text-ink-soft">Visão geral — {periodLabel}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-44">
            <option value="">Todas as contas</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Select value={range} onChange={(e) => setRange(e.target.value as Range)} className="w-36">
            <option value="month">Mensal</option>
            <option value="semester">Semestral</option>
            <option value="year">Anual</option>
          </Select>
          {range === 'month' && (
            <Select value={ym} onChange={(e) => setYm(e.target.value)} className="w-44">
              {(months ?? [currentMonth()]).map((m) => (
                <option key={m} value={m}>{monthLabel(`${m}-01`)}</option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Kpi title="Receitas" value={brl(summary?.total_receitas)} subtitle="Do período selecionado" icon={TrendingUp} tone="up" />
          <Kpi title="Despesas" value={brl(summary?.total_despesas)} subtitle="Do período selecionado" icon={TrendingDown} tone="down" />
          <Kpi
            title="Saldo do período"
            value={brl(summary?.saldo_periodo)}
            subtitle={`${summary?.qtd ?? 0} lançamento(s)`}
            icon={Scale}
            tone={Number(summary?.saldo_periodo ?? 0) >= 0 ? 'up' : 'down'}
          />
          <Kpi
            title="Saldo acumulado"
            value={brl(summary?.saldo_acumulado)}
            subtitle={`Saldo anterior: ${brl(summary?.saldo_anterior)}`}
            icon={CalendarClock}
            tone="neutral"
          />
        </div>
      )}

      <Card>
        <CardHeader title="Despesas por categoria" subtitle="Distribuição do período selecionado" />
        <div className="p-5">
          <CategoryDonut data={breakdown ?? []} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Receitas e despesas nos últimos 12 meses" subtitle="Série mensal consolidada" />
        <div className="p-5">
          <MonthlyTrend data={series ?? []} />
        </div>
      </Card>
    </div>
  )
}
