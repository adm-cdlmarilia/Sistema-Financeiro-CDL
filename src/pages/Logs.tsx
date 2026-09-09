import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { supabase, ActivityLog } from '@/lib/supabase'
import { dateTimeBR } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { Button, Card, CardHeader, Input, Select, Field, Badge, EmptyState, Skeleton } from '@/components/ui'

const PAGE_SIZE = 50

const ACTION_LABEL: Record<string, string> = {
  create: 'Criação',
  update: 'Edição',
  delete: 'Exclusão',
  bulk_create: 'Importação',
  bulk_update: 'Edição em massa',
  import: 'Importação',
  export: 'Exportação',
  revert: 'Reversão',
}

const REVERSIBLE = ['create', 'update', 'delete', 'bulk_create', 'bulk_update', 'import']

export default function Logs() {
  const qc = useQueryClient()
  const { canWrite } = useAuth()
  const [search, setSearch] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['logs', search, action, page],
    queryFn: async () => {
      let q = supabase
        .from('activity_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
      if (search) q = q.ilike('description', `%${search}%`)
      if (action) q = q.eq('action_type', action)
      const { data, error, count } = await q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data ?? []) as ActivityLog[], count: count ?? 0 }
    },
  })

  const revert = async (log: ActivityLog) => {
    if (!confirm(`Desfazer: ${log.description}?`)) return
    const { error } = await supabase.rpc('revert_activity_log', { p_log: log.id })
    if (error) { alert(error.message); return }
    qc.invalidateQueries({ queryKey: ['logs'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
  }

  const canRevert = (log: ActivityLog) =>
    canWrite && !log.reverted && REVERSIBLE.includes(log.action_type) &&
    (log.entity_ids?.length > 0 || !!log.previous_data)

  const total = data?.count ?? 0
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Logs de atividade</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Todas as operações do sistema. As reversíveis podem ser desfeitas.
        </p>
      </div>

      <Card>
        <CardHeader title="Filtros" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Buscar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <Input className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="Descrição..." />
            </div>
          </Field>
          <Field label="Tipo de ação">
            <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(0) }}>
              <option value="">Todas</option>
              {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title={`${total.toLocaleString('pt-BR')} registro(s)`} />
        {isLoading ? (
          <div className="space-y-2 p-5">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum registro" />
        ) : (
          <div className="divide-y divide-line">
            {data.rows.map((log) => (
              <div key={log.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                <span className="tabnum w-40 shrink-0 text-xs text-ink-muted">{dateTimeBR(log.created_at)}</span>
                <Badge tone="info">{ACTION_LABEL[log.action_type] ?? log.action_type}</Badge>
                <Badge>{log.entity_type}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{log.description}</p>
                  {log.details && <p className="truncate text-xs text-ink-muted">{log.details}</p>}
                </div>
                {log.reverted ? (
                  <Badge>desfeito</Badge>
                ) : canRevert(log) ? (
                  <Button size="sm" variant="ghost" onClick={() => revert(log)}>
                    <Undo2 className="h-4 w-4" /> Desfazer
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" /> Anterior
          </Button>
          <span className="text-sm text-ink-muted">Página {page + 1} de {lastPage + 1}</span>
          <Button size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
            Próxima <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    </div>
  )
}
