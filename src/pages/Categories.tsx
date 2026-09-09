import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase, Category, CategoryRule } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button, Card, CardHeader, Input, Select, Field, Badge, Modal, EmptyState } from '@/components/ui'

export default function Categories() {
  const qc = useQueryClient()
  const { canWrite } = useAuth()
  const [tab, setTab] = useState<'categorias' | 'regras'>('categorias')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'receita' | 'despesa' | 'ambos'>('ambos')
  const [editing, setEditing] = useState<Category | null>(null)
  const [rule, setRule] = useState<Partial<CategoryRule> | null>(null)

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('categories').select('*').order('name')
      if (error) throw error
      return data as Category[]
    },
  })

  const { data: rules } = useQuery({
    queryKey: ['category-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_rules')
        .select('*, categories(name)')
        .order('priority')
      if (error) throw error
      return data as CategoryRule[]
    },
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] })
    qc.invalidateQueries({ queryKey: ['category-rules'] })
  }

  const addCategory = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('categories').insert({ name: newName.trim(), kind: newKind })
      if (error) throw error
      await supabase.from('activity_logs').insert({
        entity_type: 'Categoria', action_type: 'create', description: `Categoria criada: "${newName.trim()}"`,
      })
    },
    onSuccess: () => { setNewName(''); invalidate() },
    onError: (e: any) => alert(e.message),
  })

  const updateCategory = useMutation({
    mutationFn: async (c: Category) => {
      const { error } = await supabase.from('categories').update({ name: c.name.trim(), kind: c.kind }).eq('id', c.id)
      if (error) throw error
    },
    onSuccess: () => { setEditing(null); invalidate() },
    onError: (e: any) => alert(e.message),
  })

  const deleteCategory = useMutation({
    mutationFn: async (c: Category) => {
      const { error } = await supabase.from('categories').delete().eq('id', c.id)
      if (error) throw error
      await supabase.from('activity_logs').insert({
        entity_type: 'Categoria', action_type: 'delete', previous_data: c,
        description: `Categoria excluída: "${c.name}"`,
      })
    },
    onSuccess: invalidate,
    onError: (e: any) => alert(e.message),
  })

  const saveRule = useMutation({
    mutationFn: async (r: Partial<CategoryRule>) => {
      const payload = {
        pattern: r.pattern?.trim().toLowerCase(),
        category_id: r.category_id,
        priority: Number(r.priority ?? 100),
        is_regex: !!r.is_regex,
        is_active: r.is_active ?? true,
      }
      const { error } = r.id
        ? await supabase.from('category_rules').update(payload).eq('id', r.id)
        : await supabase.from('category_rules').insert(payload)
      if (error) throw error
    },
    onSuccess: () => { setRule(null); invalidate() },
    onError: (e: any) => alert(e.message),
  })

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('category_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Categorias</h1>
        <p className="mt-1 text-sm text-ink-soft">
          As regras abaixo classificam automaticamente as transações importadas — sem precisar mexer no código.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === 'categorias' ? 'primary' : 'outline'} onClick={() => setTab('categorias')}>
          Categorias ({categories?.length ?? 0})
        </Button>
        <Button variant={tab === 'regras' ? 'primary' : 'outline'} onClick={() => setTab('regras')}>
          Regras automáticas ({rules?.length ?? 0})
        </Button>
      </div>

      {tab === 'categorias' && (
        <>
          {canWrite && (
            <Card>
              <CardHeader title="Nova categoria" />
              <form
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-end"
                onSubmit={(e) => { e.preventDefault(); if (newName.trim()) addCategory.mutate() }}
              >
                <div className="flex-1">
                  <Field label="Nome"><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Aluguel da Igreja" /></Field>
                </div>
                <div className="sm:w-48">
                  <Field label="Tipo">
                    <Select value={newKind} onChange={(e) => setNewKind(e.target.value as any)}>
                      <option value="ambos">Receita e despesa</option>
                      <option value="receita">Receita</option>
                      <option value="despesa">Despesa</option>
                    </Select>
                  </Field>
                </div>
                <Button type="submit" variant="primary"><Plus className="h-4 w-4" /> Adicionar</Button>
              </form>
            </Card>
          )}

          <Card>
            <CardHeader title="Categorias cadastradas" />
            {!categories?.length ? (
              <EmptyState title="Nenhuma categoria" />
            ) : (
              <div className="divide-y divide-line">
                {categories.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex-1 text-sm">{c.name}</span>
                    <Badge>{c.kind === 'ambos' ? 'receita e despesa' : c.kind}</Badge>
                    {canWrite && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}><Pencil className="h-4 w-4" /></Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => confirm(`Excluir "${c.name}"? As transações ficam sem categoria.`) && deleteCategory.mutate(c)}
                        >
                          <Trash2 className="h-4 w-4 text-negative" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'regras' && (
        <Card>
          <CardHeader
            title="Regras de categorização"
            subtitle="Aplicadas na ordem de prioridade (menor número primeiro), quando a descrição contém o termo"
            action={canWrite ? <Button variant="primary" size="sm" onClick={() => setRule({ priority: 100 })}><Plus className="h-4 w-4" /> Nova regra</Button> : undefined}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-3 font-medium">Prioridade</th>
                  <th className="px-5 py-3 font-medium">Se a descrição contém</th>
                  <th className="px-5 py-3 font-medium">Categoria</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  {canWrite && <th className="px-5 py-3 text-right font-medium">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {(rules ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-line/70 last:border-0">
                    <td className="tabnum px-5 py-3 text-ink-muted">{r.priority}</td>
                    <td className="px-5 py-3 font-mono text-xs">{r.pattern}</td>
                    <td className="px-5 py-3">{r.categories?.name ?? '—'}</td>
                    <td className="px-5 py-3"><Badge tone={r.is_active ? 'receita' : 'neutral'}>{r.is_active ? 'ativa' : 'inativa'}</Badge></td>
                    {canWrite && (
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setRule(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => confirm('Excluir esta regra?') && deleteRule.mutate(r.id)}>
                          <Trash2 className="h-4 w-4 text-negative" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar categoria">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); updateCategory.mutate(editing!) }}>
          <Field label="Nome">
            <Input value={editing?.name ?? ''} onChange={(e) => setEditing((c) => ({ ...c!, name: e.target.value }))} />
          </Field>
          <Field label="Tipo">
            <Select value={editing?.kind ?? 'ambos'} onChange={(e) => setEditing((c) => ({ ...c!, kind: e.target.value as any }))}>
              <option value="ambos">Receita e despesa</option>
              <option value="receita">Receita</option>
              <option value="despesa">Despesa</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button type="submit" variant="primary">Salvar</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!rule} onClose={() => setRule(null)} title={rule?.id ? 'Editar regra' : 'Nova regra'}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); saveRule.mutate(rule!) }}>
          <Field label="Termo procurado na descrição">
            <Input required value={rule?.pattern ?? ''} onChange={(e) => setRule((r) => ({ ...r!, pattern: e.target.value }))} placeholder="ex.: pix credito" />
          </Field>
          <Field label="Categoria aplicada">
            <Select required value={rule?.category_id ?? ''} onChange={(e) => setRule((r) => ({ ...r!, category_id: e.target.value }))}>
              <option value="">Selecione</option>
              {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prioridade (menor vem antes)">
              <Input type="number" value={rule?.priority ?? 100} onChange={(e) => setRule((r) => ({ ...r!, priority: Number(e.target.value) }))} />
            </Field>
            <Field label="Ativa">
              <Select value={String(rule?.is_active ?? true)} onChange={(e) => setRule((r) => ({ ...r!, is_active: e.target.value === 'true' }))}>
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setRule(null)}>Cancelar</Button>
            <Button type="submit" variant="primary">Salvar</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
