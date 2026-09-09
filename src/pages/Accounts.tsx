import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Wallet, Trash2 } from 'lucide-react'
import { supabase, Account, Profile } from '@/lib/supabase'
import { brl } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardHeader, Badge, Select, Button, Input, Field, Modal } from '@/components/ui'

const roleLabel: Record<string, string> = {
  admin: 'Administrador',
  lancador: 'Lançamentos',
  leitura: 'Somente leitura',
}

/** Cores da paleta dos gráficos, para a conta aparecer sempre com a mesma cor. */
const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

function ChangePassword() {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    if (password.length < 6) return setMsg('A senha precisa ter pelo menos 6 caracteres.')
    if (password !== confirm) return setMsg('As duas senhas não são iguais.')
    setBusy(true)
    try {
      await updatePassword(password)
      setPassword(''); setConfirm('')
      setMsg('Senha alterada.')
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Minha senha" subtitle="Altere a senha que você usa para entrar" />
      <form className="grid gap-4 p-5 sm:grid-cols-3" onSubmit={submit}>
        <Field label="Nova senha">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repita a senha">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy ? 'Salvando...' : 'Alterar senha'}
          </Button>
        </div>
        {msg && <p className="text-sm text-ink-soft sm:col-span-3">{msg}</p>}
      </form>
    </Card>
  )
}

export default function Accounts() {
  const qc = useQueryClient()
  const { isAdmin, session } = useAuth()
  const [editando, setEditando] = useState<Partial<Account> | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const { data: accounts } = useQuery({
    queryKey: ['accounts-balance'],
    queryFn: async () => {
      const { data: accs, error } = await supabase.from('accounts').select('*').order('name')
      if (error) throw error

      const withBalance = await Promise.all(
        (accs as Account[]).map(async (a) => {
          const { data } = await supabase.rpc('dashboard_summary', {
            p_start: '1900-01-01',
            p_end: '2999-12-31',
            p_account: a.id,
          })
          return {
            ...a,
            saldo: Number((data as any[])?.[0]?.saldo_acumulado ?? 0),
            qtd: (data as any[])?.[0]?.qtd ?? 0,
          }
        }),
      )
      return withBalance
    },
  })

  const { data: profiles } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at')
      if (error) throw error
      return data as Profile[]
    },
  })

  const changeRole = async (id: string, role: string) => {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id)
    if (error) {
      alert(
        error.message.includes('row-level security')
          ? 'Só um administrador altera papéis. Se você se rebaixou por engano, um administrador precisa te promover de volta.'
          : error.message,
      )
      return
    }
    qc.invalidateQueries({ queryKey: ['profiles'] })
  }

  async function salvarConta(e: React.FormEvent) {
    e.preventDefault()
    if (!editando?.name?.trim()) return
    setSalvando(true); setErro('')

    const payload = {
      name: editando.name.trim(),
      bank: editando.bank?.trim() || null,
      opening_balance: Number(editando.opening_balance ?? 0),
      color: editando.color || CORES[(accounts?.length ?? 0) % CORES.length],
      is_active: editando.is_active ?? true,
    }

    const { error } = editando.id
      ? await supabase.from('accounts').update(payload).eq('id', editando.id)
      : await supabase.from('accounts').insert(payload)

    if (error) {
      setErro(
        error.message.includes('row-level security')
          ? 'Só um administrador pode criar ou editar contas.'
          : error.message.includes('duplicate') || error.message.includes('unique')
          ? 'Já existe uma conta com esse nome.'
          : error.message,
      )
      setSalvando(false)
      return
    }

    await supabase.from('activity_logs').insert({
      entity_type: 'Conta',
      action_type: editando.id ? 'update' : 'create',
      description: `Conta ${editando.id ? 'alterada' : 'criada'}: "${payload.name}"`,
      new_data: payload,
    })

    qc.invalidateQueries({ queryKey: ['accounts-balance'] })
    qc.invalidateQueries({ queryKey: ['accounts'] })
    setEditando(null)
    setSalvando(false)
  }

  /** Só exclui conta zerada — o banco confere de novo antes de apagar. */
  async function excluirConta(conta: Account & { saldo: number; qtd: number }) {
    if (Math.abs(conta.saldo) >= 0.005) {
      setErro(`A conta tem saldo de ${brl(conta.saldo)}. Só dá para excluir conta zerada.`)
      return
    }

    const aviso = conta.qtd > 0
      ? `Excluir a conta "${conta.name}"?\n\nEla está zerada, mas tem ${conta.qtd} lançamento(s) no histórico. ` +
        `Os lançamentos continuam no sistema, porém ficarão sem conta.\n\n` +
        `Se quiser preservar o histórico com a conta, cancele e marque a conta como inativa.`
      : `Excluir a conta "${conta.name}"? Ela não tem nenhum lançamento.`

    if (!confirm(aviso)) return

    setSalvando(true); setErro('')
    const { error } = await supabase.from('accounts').delete().eq('id', conta.id)

    if (error) {
      setErro(
        error.message.includes('row-level security')
          ? 'Só um administrador pode excluir contas.'
          : error.message,
      )
      setSalvando(false)
      return
    }

    await supabase.from('activity_logs').insert({
      entity_type: 'Conta', action_type: 'delete',
      previous_data: conta,
      description: `Conta excluída: "${conta.name}"`,
      details: conta.qtd > 0 ? `${conta.qtd} lançamento(s) ficaram sem conta` : 'sem lançamentos',
    })

    qc.invalidateQueries({ queryKey: ['accounts-balance'] })
    qc.invalidateQueries({ queryKey: ['accounts'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    setEditando(null)
    setSalvando(false)
  }

  const contaEditada = (accounts ?? []).find((a) => a.id === editando?.id)
  const podeExcluir = !!contaEditada && Math.abs(contaEditada.saldo) < 0.005

  const total = (accounts ?? []).reduce((a, b) => a + b.saldo, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contas e acessos</h1>
          <p className="mt-1 text-sm text-ink-soft">Saldo por conta e permissões dos usuários</p>
        </div>
        {isAdmin && (
          <Button
            variant="primary"
            onClick={() => { setErro(''); setEditando({ opening_balance: 0, is_active: true }) }}
          >
            <Plus className="h-4 w-4" /> Nova conta
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {(accounts ?? []).map((a) => (
          <Card key={a.id} className={`p-5 ${!a.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color ?? '#898781' }} />
                <p className="text-sm font-medium">{a.name}</p>
              </div>
              {isAdmin && (
                <button
                  onClick={() => { setErro(''); setEditando(a) }}
                  className="rounded p-1 text-ink-muted hover:bg-surface-page"
                  aria-label={`Editar ${a.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="tabnum mt-3 text-xl font-semibold">{brl(a.saldo)}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {a.qtd} lançamento(s){!a.is_active && ' · inativa'}
            </p>
          </Card>
        ))}

        <Card className="border-brand-100 bg-brand-50 p-5">
          <p className="text-sm font-medium text-brand-700">Saldo consolidado</p>
          <p className="tabnum mt-3 text-xl font-semibold text-brand-700">{brl(total)}</p>
          <p className="mt-1 text-xs text-brand-600">Soma das contas</p>
        </Card>
      </div>

      <ChangePassword />

      <Card>
        <CardHeader
          title="Usuários"
          subtitle={isAdmin ? 'Você pode alterar o papel das outras pessoas' : 'Somente administradores alteram papéis'}
        />
        <div className="divide-y divide-line">
          {(profiles ?? []).map((p) => (
            <div key={p.id} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.full_name ?? p.email}</p>
                <p className="truncate text-xs text-ink-muted">{p.email}</p>
              </div>
              {isAdmin && p.id !== session?.user?.id ? (
                <Select className="w-48" value={p.role} onChange={(e) => changeRole(p.id, e.target.value)}>
                  <option value="admin">Administrador</option>
                  <option value="lancador">Lançamentos</option>
                  <option value="leitura">Somente leitura</option>
                </Select>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge>{roleLabel[p.role]}</Badge>
                  {p.id === session?.user?.id && <span className="text-xs text-ink-muted">(você)</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Modal
        open={!!editando}
        onClose={() => setEditando(null)}
        title={editando?.id ? 'Editar conta' : 'Nova conta'}
      >
        <form className="space-y-4" onSubmit={salvarConta}>
          {erro && (
            <p className="rounded-lg border border-negative/20 bg-negative-soft px-3 py-2 text-sm text-negative">{erro}</p>
          )}

          <Field label="Nome da conta">
            <Input
              required autoFocus placeholder="Ex.: Guilherme"
              value={editando?.name ?? ''}
              onChange={(e) => setEditando((a) => ({ ...a!, name: e.target.value }))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Banco (opcional)">
              <Input
                placeholder="Cresol, Cora, Mercado Pago..."
                value={editando?.bank ?? ''}
                onChange={(e) => setEditando((a) => ({ ...a!, bank: e.target.value }))}
              />
            </Field>
            <Field label="Saldo inicial (R$)">
              <Input
                type="number" step="0.01"
                value={editando?.opening_balance ?? 0}
                onChange={(e) => setEditando((a) => ({ ...a!, opening_balance: Number(e.target.value) }))}
              />
            </Field>
          </div>

          <Field label="Cor nos gráficos">
            <div className="flex flex-wrap gap-2">
              {CORES.map((c) => (
                <button
                  key={c} type="button"
                  onClick={() => setEditando((a) => ({ ...a!, color: c }))}
                  className={`h-8 w-8 rounded-lg border-2 transition-transform ${
                    editando?.color === c ? 'scale-110 border-ink' : 'border-transparent'
                  }`}
                  style={{ background: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
          </Field>

          {editando?.id && (
            <Field label="Situação">
              <Select
                value={String(editando?.is_active ?? true)}
                onChange={(e) => setEditando((a) => ({ ...a!, is_active: e.target.value === 'true' }))}
              >
                <option value="true">Ativa</option>
                <option value="false">Inativa (não aparece na importação)</option>
              </Select>
            </Field>
          )}

          <p className="flex items-start gap-2 text-xs text-ink-muted">
            <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            O nome é o que precisa aparecer na coluna Conta dos arquivos importados.
          </p>

          <div className="flex items-center gap-2 border-t border-line pt-4">
            {contaEditada && (
              podeExcluir ? (
                <Button
                  type="button" variant="danger" size="sm" disabled={salvando}
                  onClick={() => excluirConta(contaEditada)}
                >
                  <Trash2 className="h-4 w-4" /> Excluir conta
                </Button>
              ) : (
                <span className="text-xs text-ink-muted">
                  Saldo de {brl(contaEditada.saldo)} — só é possível excluir uma conta zerada.
                </span>
              )
            )}

            <div className="ml-auto flex gap-2">
              <Button type="button" onClick={() => setEditando(null)}>Cancelar</Button>
              <Button type="submit" variant="primary" disabled={salvando}>
                {salvando ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
