import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import { supabase, Account, Category } from '@/lib/supabase'
import { brl, currentMonth, firstDayOfMonth, lastDayOfMonth } from '@/lib/format'
import { Button, Card, CardHeader, Field, Input, Select, EmptyState } from '@/components/ui'

export default function Reports() {
  const [from, setFrom] = useState(firstDayOfMonth(currentMonth()))
  const [to, setTo] = useState(lastDayOfMonth(currentMonth()))
  const [type, setType] = useState('')
  const [accountId, setAccountId] = useState('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('name')
      if (error) throw error
      return data as Account[]
    },
  })

  const { data: rows, isLoading } = useQuery({
    queryKey: ['report', from, to, type, accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('category_breakdown', {
        p_start: from, p_end: to,
        p_type: type || null,
        p_account: accountId || null,
      })
      if (error) throw error
      return (data as any[]).map((r) => ({
        category: r.category,
        receitas: Number(r.receitas),
        despesas: Number(r.despesas),
        qtd: r.qtd,
      }))
    },
  })

  const { data: summary } = useQuery({
    queryKey: ['report-summary', from, to, accountId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_summary', {
        p_start: from, p_end: to, p_account: accountId || null,
      })
      if (error) throw error
      return (data as any[])[0]
    },
  })

  /** Quanto entrou (e saiu) em cada conta no período — respeita o filtro de conta. */
  const { data: porConta } = useQuery({
    queryKey: ['report-por-conta', from, to, accountId, accounts?.length],
    enabled: !!accounts?.length,
    queryFn: async () => {
      const alvo = accountId ? accounts!.filter((a) => a.id === accountId) : accounts!
      const linhas = await Promise.all(
        alvo.map(async (a) => {
          const { data } = await supabase.rpc('dashboard_summary', {
            p_start: from, p_end: to, p_account: a.id,
          })
          const s = (data as any[])?.[0]
          return {
            id: a.id,
            name: a.name,
            color: a.color,
            recebido: Number(s?.total_receitas ?? 0),
            pago: Number(s?.total_despesas ?? 0),
            qtd: Number(s?.qtd ?? 0),
          }
        }),
      )
      return linhas.sort((x, y) => y.recebido - x.recebido)
    },
  })

  const totalRecebido = (porConta ?? []).reduce((a, b) => a + b.recebido, 0)

  const totals = (rows ?? []).reduce(
    (acc, r) => ({ receitas: acc.receitas + r.receitas, despesas: acc.despesas + r.despesas }),
    { receitas: 0, despesas: 0 },
  )

  const exportCsv = () => {
    const header = ['Categoria', 'Receitas', 'Despesas', 'Lançamentos']
    const body = (rows ?? []).map((r) => [
      r.category,
      r.receitas.toFixed(2).replace('.', ','),
      r.despesas.toFixed(2).replace('.', ','),
      r.qtd,
    ])
    const total = ['TOTAL',
      totals.receitas.toFixed(2).replace('.', ','),
      totals.despesas.toFixed(2).replace('.', ','), '']
    // segunda seção do arquivo: quanto entrou em cada conta
    const secaoContas: any[][] = porConta?.length
      ? [[], ['RECEBIDO POR CONTA'], ['Conta', 'Recebido', 'Pago', 'Lançamentos'],
         ...porConta.map((c) => [
           c.name,
           c.recebido.toFixed(2).replace('.', ','),
           c.pago.toFixed(2).replace('.', ','),
           c.qtd,
         ]),
         ['TOTAL', totalRecebido.toFixed(2).replace('.', ','), '', '']]
      : []

    const csv = [header, ...body, total, ...secaoContas]
      .map((l) => l.map((c) => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `relatorio-${from}-a-${to}.csv`
    a.click()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios por categoria</h1>
          <p className="mt-1 text-sm text-ink-soft">Receitas e despesas detalhadas por período</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button onClick={exportCsv}><Download className="h-4 w-4" /> CSV</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / PDF</Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader title="Filtros" />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="De"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Tipo">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Todos</option>
              <option value="receita">Somente receitas</option>
              <option value="despesa">Somente despesas</option>
            </Select>
          </Field>
          <Field label="Conta">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Todas</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-ink-soft">Receitas do período</p>
          <p className="tabnum mt-2 text-2xl font-semibold text-brand-600">{brl(totals.receitas)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-ink-soft">Despesas do período</p>
          <p className="tabnum mt-2 text-2xl font-semibold text-negative">{brl(totals.despesas)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-ink-soft">Saldo acumulado até {to.split('-').reverse().join('/')}</p>
          <p className="tabnum mt-2 text-2xl font-semibold">{brl(summary?.saldo_acumulado)}</p>
          <p className="mt-1 text-xs text-ink-muted">Saldo anterior + resultado do período</p>
        </Card>
      </div>

      <Card className="break-inside-avoid print:border-0 print:shadow-none">
        <CardHeader
          title="Recebido por conta"
          subtitle="Entradas de cada conta no período selecionado"
        />
        {!porConta?.length ? (
          <EmptyState title="Nenhuma conta cadastrada" />
        ) : (
          <div className="divide-y divide-line">
            {porConta.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: c.color ?? '#8a8983' }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-ink-muted">
                    {c.qtd} lançamento(s) · {brl(c.pago)} em saídas
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabnum text-sm font-semibold text-brand-600">{brl(c.recebido)}</p>
                  <p className="tabnum text-xs text-ink-muted">
                    {totalRecebido > 0 ? `${((c.recebido / totalRecebido) * 100).toFixed(0)}%` : '—'}
                  </p>
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between bg-surface-page px-5 py-3 text-sm font-semibold">
              <span>Total recebido</span>
              <span className="tabnum">{brl(totalRecebido)}</span>
            </div>
          </div>
        )}
      </Card>

      <Card className="print:break-before-page print:border-0 print:shadow-none">
        <CardHeader
          title="Detalhamento por categoria"
          subtitle={isLoading ? 'Carregando...' : `${rows?.length ?? 0} categoria(s) no período`}
        />
        {!isLoading && !rows?.length ? (
          <EmptyState title="Nenhum lançamento no período" hint="Ajuste as datas ou os filtros acima." />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Categoria</th>
                <th className="px-5 py-3 text-right font-medium">Receitas</th>
                <th className="px-5 py-3 text-right font-medium">Despesas</th>
                <th className="px-5 py-3 text-right font-medium">Lanç.</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.category} className="border-b border-line/70 last:border-0">
                  <td className="px-5 py-3">{r.category}</td>
                  <td className="tabnum px-5 py-3 text-right text-brand-600">{brl(r.receitas)}</td>
                  <td className="tabnum px-5 py-3 text-right text-negative">{brl(r.despesas)}</td>
                  <td className="tabnum px-5 py-3 text-right text-ink-muted">{r.qtd}</td>
                </tr>
              ))}
              <tr className="bg-surface-page font-semibold">
                <td className="px-5 py-3">Total geral</td>
                <td className="tabnum px-5 py-3 text-right">{brl(totals.receitas)}</td>
                <td className="tabnum px-5 py-3 text-right">{brl(totals.despesas)}</td>
                <td className="tabnum px-5 py-3 text-right text-ink-muted">
                  {(rows ?? []).reduce((a, b) => a + b.qtd, 0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </Card>
    </div>
  )
}
