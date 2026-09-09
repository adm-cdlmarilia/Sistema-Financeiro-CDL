import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Download, Plus, Pencil, Trash2, Search, ChevronLeft, ChevronRight, X, Tag, Wallet,
} from 'lucide-react'
import { supabase, Transaction, Category, Account } from '@/lib/supabase'
import { brl, dateBR } from '@/lib/format'
import { exportTransactions } from '@/lib/parseStatement'
import { useAuth } from '@/hooks/useAuth'
import {
  Button, Card, CardHeader, Input, Select, Field, Badge, Modal, EmptyState, Skeleton,
} from '@/components/ui'

const PAGE_SIZE = 50

interface Filters {
  search: string
  from: string
  to: string
  category: string
  account: string
  type: string
  min: string
  max: string
}

const emptyFilters: Filters = { search: '', from: '', to: '', category: '', account: '', type: '', min: '', max: '' }

export default function Transactions() {
  const qc = useQueryClient()
  const { canWrite } = useAuth()
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Partial<Transaction> | null>(null)
  const [busy, setBusy] = useState(false)

  // seleção múltipla
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'categoria' | 'conta' | null>(null)
  const [bulkValue, setBulkValue] = useState('')

  const set = (k: keyof Filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v })); setPage(0); setSelected(new Set())
  }

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name')
      if (error) throw error
      return data as Category[]
    },
  })

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('name')
      if (error) throw error
      return data as Account[]
    },
  })

  /** Filtro, ordenação e paginação acontecem no Postgres — nunca no navegador. */
  const buildQuery = (forExport = false) => {
    let q = supabase
      .from('transactions')
      .select('*, categories(name), accounts(name)', forExport ? {} : { count: 'exact' })
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (filters.search) q = q.ilike('description', `%${filters.search}%`)
    if (filters.from) q = q.gte('date', filters.from)
    if (filters.to) q = q.lte('date', filters.to)
    if (filters.category) q = q.eq('category_id', filters.category)
    if (filters.account) q = q.eq('account_id', filters.account)
    if (filters.type) q = q.eq('type', filters.type)
    if (filters.min) q = q.gte('amount', Number(filters.min))
    if (filters.max) q = q.lte('amount', Number(filters.max))
    return q
  }

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', filters, page],
    queryFn: async () => {
      const { data, error, count } = await buildQuery().range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as Transaction[], count: count ?? 0 }
    },
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
    qc.invalidateQueries({ queryKey: ['breakdown'] })
    qc.invalidateQueries({ queryKey: ['monthly-series'] })
    qc.invalidateQueries({ queryKey: ['accounts-balance'] })
  }

  const save = useMutation({
    mutationFn: async (tx: Partial<Transaction>) => {
      const payload = {
        date: tx.date,
        description: tx.description?.trim(),
        amount: Math.abs(Number(tx.amount)),
        type: tx.type,
        category_id: tx.category_id || null,
        account_id: tx.account_id || null,
        notes: tx.notes || null,
      }
      if (tx.id) {
        const { data: before } = await supabase.from('transactions').select('*').eq('id', tx.id).single()
        const { error } = await supabase.from('transactions').update(payload).eq('id', tx.id)
        if (error) throw error
        await supabase.from('activity_logs').insert({
          entity_type: 'Transação', entity_ids: [tx.id], action_type: 'update',
          previous_data: before, new_data: payload,
          description: `Transação editada: "${payload.description}"`,
          details: brl(payload.amount),
        })
      } else {
        const { data: created, error } = await supabase
          .from('transactions').insert({ ...payload, source: 'manual' }).select('id').single()
        if (error) throw error
        await supabase.from('activity_logs').insert({
          entity_type: 'Transação', entity_ids: [created.id], action_type: 'create',
          new_data: payload, description: `Transação criada: "${payload.description}"`,
          details: `${brl(payload.amount)} · ${payload.type}`,
        })
      }
    },
    onSuccess: () => { invalidate(); setEditing(null) },
    onError: (e: any) => alert(e.message),
  })

  const remove = useMutation({
    mutationFn: async (tx: Transaction) => {
      const { error } = await supabase.from('transactions').delete().eq('id', tx.id)
      if (error) throw error
      await supabase.from('activity_logs').insert({
        entity_type: 'Transação', entity_ids: [tx.id], action_type: 'delete',
        previous_data: [tx], description: `Transação excluída: "${tx.description}"`,
        details: brl(tx.amount),
      })
    },
    onSuccess: () => { setEditing(null); invalidate() },
    onError: (e: any) => alert(e.message),
  })

  /** Exclusão em massa — grava o log com os dados completos, então dá para desfazer. */
  const removeMany = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data: before, error: e1 } = await supabase
        .from('transactions').select('*').in('id', ids)
      if (e1) throw e1

      const { error } = await supabase.from('transactions').delete().in('id', ids)
      if (error) throw error

      const total = (before ?? []).reduce((a: number, t: any) => a + Number(t.amount), 0)
      await supabase.from('activity_logs').insert({
        entity_type: 'Transação', entity_ids: ids, action_type: 'delete',
        previous_data: before,
        description: `${ids.length} transação(ões) excluída(s) em massa`,
        details: `Total: ${brl(total)}`,
      })
    },
    onSuccess: () => { setSelected(new Set()); invalidate() },
    onError: (e: any) => alert(e.message),
  })

  /** Troca categoria ou conta de várias transações de uma vez. */
  const updateMany = useMutation({
    mutationFn: async ({ ids, field, value }: { ids: string[]; field: 'category_id' | 'account_id'; value: string | null }) => {
      const { data: before, error: e1 } = await supabase
        .from('transactions').select('*').in('id', ids)
      if (e1) throw e1

      const { error } = await supabase.from('transactions').update({ [field]: value }).in('id', ids)
      if (error) throw error

      const nome = field === 'category_id'
        ? categories?.find((c) => c.id === value)?.name ?? 'sem categoria'
        : accounts?.find((a) => a.id === value)?.name ?? 'sem conta'

      await supabase.from('activity_logs').insert({
        entity_type: 'Transação', entity_ids: ids, action_type: 'bulk_update',
        previous_data: before,
        description: `${ids.length} transação(ões) alterada(s) em massa`,
        details: `${field === 'category_id' ? 'Categoria' : 'Conta'}: ${nome}`,
      })
    },
    onSuccess: () => { setSelected(new Set()); setBulkAction(null); setBulkValue(''); invalidate() },
    onError: (e: any) => alert(e.message),
  })

  /** Exporta o resultado dos filtros atuais, não só a página visível. */
  const handleExport = async (fmt: 'xlsx' | 'csv') => {
    setBusy(true)
    try {
      const rows: any[] = []
      for (let i = 0; ; i += 1000) {
        const { data, error } = await buildQuery(true).range(i, i + 999)
        if (error) throw error
        rows.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      exportTransactions(
        rows.map((r) => ({
          date: r.date, description: r.description, amount: Number(r.amount), type: r.type,
          category: r.categories?.name ?? '', account: r.accounts?.name ?? '', source: r.source,
        })),
        `transacoes-${new Date().toISOString().slice(0, 10)}`,
        fmt,
      )
      await supabase.from('activity_logs').insert({
        entity_type: 'Transação', action_type: 'export',
        description: `Exportação de transações em ${fmt.toUpperCase()}`,
        details: `${rows.length} registro(s)`,
      })
    } finally {
      setBusy(false)
    }
  }

  const total = data?.count ?? 0
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)
  const rows = data?.rows ?? []
  const allOnPageSelected = rows.length > 0 && rows.every((t) => selected.has(t.id))

  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const togglePage = () =>
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) rows.forEach((t) => n.delete(t.id))
      else rows.forEach((t) => n.add(t.id))
      return n
    })

  /** Seleciona TODAS as transações do filtro atual, não só a página. */
  const selectAllFiltered = async () => {
    setBusy(true)
    try {
      const ids: string[] = []
      for (let i = 0; ; i += 1000) {
        const { data, error } = await buildQuery(true).range(i, i + 999)
        if (error) throw error
        ids.push(...(data ?? []).map((t: any) => t.id))
        if (!data || data.length < 1000) break
      }
      setSelected(new Set(ids))
    } finally {
      setBusy(false)
    }
  }

  const selectedTotal = rows
    .filter((t) => selected.has(t.id))
    .reduce((a, t) => a + Number(t.amount), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transações</h1>
          <p className="mt-1 text-sm text-ink-soft">Todos os lançamentos financeiros</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => handleExport('xlsx')} disabled={busy}>
            <Download className="h-4 w-4" /> XLSX
          </Button>
          <Button onClick={() => handleExport('csv')} disabled={busy}>
            <Download className="h-4 w-4" /> CSV
          </Button>
          {canWrite && (
            <Button variant="primary" onClick={() => setEditing({ type: 'despesa', date: new Date().toISOString().slice(0, 10) })}>
              <Plus className="h-4 w-4" /> Nova transação
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Filtros"
          action={<Button size="sm" variant="ghost" onClick={() => { setFilters(emptyFilters); setPage(0); setSelected(new Set()) }}>Limpar</Button>}
        />
        <div className="grid gap-4 p-5 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Buscar na descrição">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input className="pl-9" value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder="Ex.: pix, aluguel..." />
            </div>
          </Field>
          <Field label="De"><Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} /></Field>
          <Field label="Até"><Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} /></Field>
          <Field label="Conta">
            <Select value={filters.account} onChange={(e) => set('account', e.target.value)}>
              <option value="">Todas</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Categoria">
            <Select value={filters.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Todas</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Tipo">
            <Select value={filters.type} onChange={(e) => set('type', e.target.value)}>
              <option value="">Todos</option>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
            </Select>
          </Field>
          <Field label="Valor mínimo"><Input type="number" step="0.01" value={filters.min} onChange={(e) => set('min', e.target.value)} placeholder="0,00" /></Field>
          <Field label="Valor máximo"><Input type="number" step="0.01" value={filters.max} onChange={(e) => set('max', e.target.value)} placeholder="0,00" /></Field>
        </div>
      </Card>

      {/* barra de ações em massa */}
      {canWrite && selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 shadow-card">
          <span className="text-sm font-medium text-brand-700">
            {selected.size} selecionada(s)
            {selectedTotal > 0 && <span className="ml-2 font-normal text-brand-600">· {brl(selectedTotal)} nesta página</span>}
          </span>

          {selected.size < total && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={selectAllFiltered}>
              Selecionar todas as {total}
            </Button>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setBulkAction('categoria'); setBulkValue('') }}>
              <Tag className="h-4 w-4" /> Alterar categoria
            </Button>
            <Button size="sm" onClick={() => { setBulkAction('conta'); setBulkValue('') }}>
              <Wallet className="h-4 w-4" /> Alterar conta
            </Button>
            <Button
              size="sm" variant="danger" disabled={removeMany.isPending}
              onClick={() => {
                if (confirm(`Excluir ${selected.size} transação(ões)? Dá para desfazer em Logs de atividade.`)) {
                  removeMany.mutate([...selected])
                }
              }}
            >
              <Trash2 className="h-4 w-4" />
              {removeMany.isPending ? 'Excluindo...' : `Excluir ${selected.size}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X className="h-4 w-4" /> Limpar seleção
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader title={`${total.toLocaleString('pt-BR')} transação(ões)`} subtitle={`Página ${page + 1} de ${lastPage + 1}`} />

        {isLoading ? (
          <div className="space-y-2 p-5">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
        ) : !rows.length ? (
          <EmptyState title="Nenhuma transação encontrada" hint="Ajuste os filtros ou importe um extrato." />
        ) : (
          <div>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                  {canWrite && (
                    <th className="w-9 pl-4 pr-1 py-3">
                      <input
                        type="checkbox" checked={allOnPageSelected} onChange={togglePage}
                        className="h-4 w-4 cursor-pointer accent-brand-500"
                        aria-label="Selecionar todas desta página"
                      />
                    </th>
                  )}
                  <th className="w-[100px] pl-2 pr-4 py-3 font-medium">Data</th>
                  <th className="px-2 py-3 font-medium">Descrição</th>
                  <th className="w-[120px] px-2 py-3 text-right font-medium">Valor</th>
                  <th className="w-[150px] px-2 py-3 font-medium">Categoria</th>
                  <th className="hidden w-[110px] px-2 py-3 font-medium lg:table-cell">Conta</th>
                  <th className="hidden w-[90px] px-2 py-3 font-medium xl:table-cell">Tipo</th>
                  {canWrite && <th className="w-[52px] pl-1 pr-3 py-3 text-right font-medium">Editar</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className={`border-b border-line/70 last:border-0 hover:bg-surface-page ${selected.has(t.id) ? 'bg-brand-50/60' : ''}`}
                  >
                    {canWrite && (
                      <td className="pl-4 pr-1 py-3">
                        <input
                          type="checkbox" checked={selected.has(t.id)} onChange={() => toggleOne(t.id)}
                          className="h-4 w-4 cursor-pointer accent-brand-500"
                          aria-label={`Selecionar ${t.description}`}
                        />
                      </td>
                    )}
                    <td className="tabnum whitespace-nowrap pl-2 pr-4 py-3 text-ink-soft">{dateBR(t.date)}</td>
                    <td className="truncate px-2 py-3" title={t.description}>{t.description}</td>
                    <td className={`tabnum whitespace-nowrap px-2 py-3 text-right font-medium ${t.type === 'receita' ? 'text-brand-600' : 'text-negative'}`}>
                      {t.type === 'receita' ? '+' : '−'} {brl(t.amount)}
                    </td>
                    <td className="px-2 py-3"><Badge>{t.categories?.name ?? 'Sem categoria'}</Badge></td>
                    <td className="hidden truncate px-2 py-3 text-ink-soft lg:table-cell">{t.accounts?.name ?? '—'}</td>
                    <td className="hidden px-2 py-3 xl:table-cell"><Badge tone={t.type === 'receita' ? 'receita' : 'despesa'}>{t.type}</Badge></td>
                    {canWrite && (
                      <td className="whitespace-nowrap pl-1 pr-3 py-3 text-right">
                        <Button size="sm" variant="ghost" className="px-2" onClick={() => setEditing(t)} aria-label={`Editar ${t.description}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-sm text-ink-muted">
            {total ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} de ${total}` : '—'}
          </span>
          <Button size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {/* alteração em massa */}
      <Modal
        open={!!bulkAction}
        onClose={() => setBulkAction(null)}
        title={bulkAction === 'categoria' ? 'Alterar categoria em massa' : 'Alterar conta em massa'}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            updateMany.mutate({
              ids: [...selected],
              field: bulkAction === 'categoria' ? 'category_id' : 'account_id',
              value: bulkValue || null,
            })
          }}
        >
          <p className="text-sm text-ink-soft">
            {selected.size} transação(ões) serão alteradas. Dá para desfazer em Logs de atividade.
          </p>
          <Field label={bulkAction === 'categoria' ? 'Nova categoria' : 'Nova conta'}>
            <Select value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}>
              <option value="">{bulkAction === 'categoria' ? 'Sem categoria' : 'Sem conta'}</option>
              {bulkAction === 'categoria'
                ? categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                : accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setBulkAction(null)}>Cancelar</Button>
            <Button type="submit" variant="primary" disabled={updateMany.isPending}>
              {updateMany.isPending ? 'Aplicando...' : 'Aplicar'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar transação' : 'Nova transação'}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(editing!) }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Data">
              <Input type="date" required value={editing?.date ?? ''} onChange={(e) => setEditing((t) => ({ ...t!, date: e.target.value }))} />
            </Field>
            <Field label="Valor (R$)">
              <Input type="number" step="0.01" min="0" required value={editing?.amount ?? ''} onChange={(e) => setEditing((t) => ({ ...t!, amount: Number(e.target.value) }))} />
            </Field>
          </div>
          <Field label="Descrição">
            <Input required value={editing?.description ?? ''} onChange={(e) => setEditing((t) => ({ ...t!, description: e.target.value }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tipo">
              <Select value={editing?.type ?? 'despesa'} onChange={(e) => setEditing((t) => ({ ...t!, type: e.target.value as any }))}>
                <option value="receita">Receita</option>
                <option value="despesa">Despesa</option>
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={editing?.category_id ?? ''} onChange={(e) => setEditing((t) => ({ ...t!, category_id: e.target.value }))}>
                <option value="">Sem categoria</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Conta">
            <Select value={editing?.account_id ?? ''} onChange={(e) => setEditing((t) => ({ ...t!, account_id: e.target.value }))}>
              <option value="">Não informada</option>
              {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Observações">
            <Input value={editing?.notes ?? ''} onChange={(e) => setEditing((t) => ({ ...t!, notes: e.target.value }))} />
          </Field>

          <div className="flex items-center gap-2 border-t border-line pt-4">
            {editing?.id && (
              <Button
                type="button" variant="danger" size="sm" disabled={remove.isPending}
                onClick={() => {
                  if (confirm(`Excluir "${editing.description}"?\n\nDá para desfazer em Logs de atividade.`)) {
                    remove.mutate(editing as Transaction)
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
                {remove.isPending ? 'Excluindo...' : 'Excluir'}
              </Button>
            )}

            <div className="ml-auto flex gap-2">
              <Button type="button" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button type="submit" variant="primary" disabled={save.isPending}>
                {save.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
