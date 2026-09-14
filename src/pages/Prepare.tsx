import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileSpreadsheet, ArrowLeftRight, X, AlertTriangle, Check } from 'lucide-react'
import { supabase, Account } from '@/lib/supabase'
import { brl, dateBR } from '@/lib/format'
import { parseRawStatement, exportTransactions, RawRow } from '@/lib/parseStatement'
import { unificar, marcarTransferencias, LinhaPreparada } from '@/lib/prepararExtratos'
import {
  Button, Card, CardHeader, Input, Field, Badge, EmptyState,
} from '@/components/ui'

interface Fonte {
  fileName: string
  rows: RawRow[]
  skipped: number
}

export default function Prepare() {
  /** Extrato lido por conta — a chave é o id da conta. */
  const [fontes, setFontes] = useState<Record<string, Fonte>>({})
  const [erros, setErros] = useState<Record<string, string>>({})
  const [lendo, setLendo] = useState<string | null>(null)
  const [tolerancia, setTolerancia] = useState(3)
  const [linhas, setLinhas] = useState<LinhaPreparada[]>([])
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts').select('*').order('name')
      if (error) throw error
      return data as Account[]
    },
  })

  const ativas = useMemo(() => (accounts ?? []).filter((a) => a.is_active), [accounts])

  /**
   * Refaz a unificação sempre que entra um extrato novo ou muda a
   * tolerância. Isso descarta os ajustes manuais feitos na revisão — é o
   * preço de recalcular o pareamento, e a tela avisa.
   */
  useEffect(() => {
    const usadas = ativas
      .filter((a) => fontes[a.id])
      .map((a) => ({ accountName: a.name, rows: fontes[a.id].rows }))

    if (!usadas.length) { setLinhas([]); return }
    setLinhas(marcarTransferencias(unificar(usadas), tolerancia))
  }, [fontes, ativas, tolerancia])

  const carregar = async (accountId: string, file: File | undefined) => {
    if (!file) return
    setLendo(accountId)
    setErros((e) => ({ ...e, [accountId]: '' }))
    try {
      const { rows, skipped } = await parseRawStatement(file)
      setFontes((f) => ({ ...f, [accountId]: { fileName: file.name, rows, skipped } }))
    } catch (e: any) {
      setErros((er) => ({ ...er, [accountId]: e.message }))
      setFontes((f) => { const n = { ...f }; delete n[accountId]; return n })
    } finally {
      setLendo(null)
      if (inputs.current[accountId]) inputs.current[accountId]!.value = ''
    }
  }

  const remover = (accountId: string) => {
    setFontes((f) => { const n = { ...f }; delete n[accountId]; return n })
    setErros((e) => ({ ...e, [accountId]: '' }))
  }

  const alternar = (key: string) =>
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, include: !l.include } : l)))

  const incluidas = linhas.filter((l) => l.include)
  const transferencias = linhas.filter((l) => l.parDe)
  const valorTransferido = transferencias
    .filter((l) => l.type === 'despesa')
    .reduce((a, l) => a + l.amount, 0)

  const receitas = incluidas.filter((l) => l.type === 'receita').reduce((a, l) => a + l.amount, 0)
  const despesas = incluidas.filter((l) => l.type === 'despesa').reduce((a, l) => a + l.amount, 0)

  const baixar = (fmt: 'xlsx' | 'csv') => {
    exportTransactions(
      incluidas.map((l) => ({
        date: l.date,
        description: l.description,
        amount: l.amount,
        type: l.type,
        account: l.accountName,
        category: '',
      })),
      `extrato-preparado-${new Date().toISOString().slice(0, 10)}`,
      fmt,
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Preparação de arquivo</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Junte os extratos das contas num arquivo só, sem as transferências entre elas, pronto
          para a tela Importar extrato.
        </p>
      </div>

      {/* ------------------------------------------------ 1. envio */}
      <Card>
        <CardHeader
          title="1. Envie o extrato de cada conta"
          subtitle="Um arquivo por conta, em CSV ou XLSX, como vem do banco"
        />
        <div className="grid gap-4 p-5 md:grid-cols-2 lg:grid-cols-3">
          {ativas.map((a) => {
            const fonte = fontes[a.id]
            const erro = erros[a.id]
            return (
              <div key={a.id} className="rounded-xl border border-line p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: a.color ?? '#9aa3af' }}
                  />
                  <p className="truncate font-medium">{a.name}</p>
                </div>

                <input
                  ref={(el) => { inputs.current[a.id] = el }}
                  type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                  onChange={(e) => carregar(a.id, e.target.files?.[0])}
                />

                {fonte ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      <span className="min-w-0">
                        <span className="block truncate" title={fonte.fileName}>{fonte.fileName}</span>
                        <span className="text-xs text-ink-muted">
                          {fonte.rows.length} linha(s)
                          {fonte.skipped > 0 && ` · ${fonte.skipped} ignorada(s)`}
                        </span>
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => remover(a.id)}>
                      <X className="h-4 w-4" /> Remover
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <Button
                      size="sm" disabled={lendo === a.id}
                      onClick={() => inputs.current[a.id]?.click()}
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      {lendo === a.id ? 'Lendo...' : 'Escolher arquivo'}
                    </Button>
                  </div>
                )}

                {erro && (
                  <p className="mt-3 flex items-start gap-2 whitespace-pre-line rounded-lg bg-negative-soft p-2 text-xs text-negative">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {erro}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {!linhas.length ? (
        <EmptyState
          title="Nenhum extrato carregado"
          hint="Envie ao menos um arquivo acima para começar."
        />
      ) : (
        <>
          {/* --------------------------------------- 2. transferências */}
          <Card>
            <CardHeader
              title="2. Transferências entre contas"
              subtitle="O mesmo dinheiro saindo de uma conta e entrando em outra não é receita nem despesa"
            />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-end gap-4">
                <div className="w-44">
                  <Field
                    label="Tolerância de dias"
                    hint="Diferença máxima entre a saída e a entrada"
                  >
                    <Input
                      type="number" min="0" max="30" value={tolerancia}
                      onChange={(e) => setTolerancia(Math.max(0, Number(e.target.value)))}
                    />
                  </Field>
                </div>
                <p className="pb-1 text-sm text-ink-soft">
                  {transferencias.length
                    ? <>
                        <strong>{transferencias.length / 2} transferência(s)</strong> encontrada(s),
                        somando {brl(valorTransferido)}. As duas pontas de cada uma já saíram do
                        arquivo final.
                      </>
                    : 'Nenhuma transferência entre contas encontrada com essa tolerância.'}
                </p>
              </div>

              {transferencias.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full text-sm">
                    <tbody>
                      {transferencias
                        .filter((l) => l.type === 'despesa')
                        .map((saida) => {
                          const entrada = linhas.find((l) => l.key === saida.parDe)
                          return (
                            <tr key={saida.key} className="border-b border-line/70 last:border-0">
                              <td className="whitespace-nowrap py-2.5 pl-4 pr-2 text-ink-soft">
                                {dateBR(saida.date)}
                              </td>
                              <td className="px-2 py-2.5">
                                <span className="flex items-center gap-2">
                                  <Badge>{saida.accountName}</Badge>
                                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                                  <Badge>{entrada?.accountName ?? '—'}</Badge>
                                </span>
                              </td>
                              <td className="truncate px-2 py-2.5 text-ink-soft" title={saida.description}>
                                {saida.description}
                              </td>
                              <td className="tabnum whitespace-nowrap py-2.5 pl-2 pr-4 text-right font-medium">
                                {brl(saida.amount)}
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-ink-muted">
                Mudar a tolerância refaz o pareamento e desfaz os ajustes manuais da revisão abaixo.
              </p>
            </div>
          </Card>

          {/* --------------------------------------- 3. revisão */}
          <Card>
            <CardHeader
              title="3. Revisão"
              subtitle={`${incluidas.length} de ${linhas.length} linha(s) vão para o arquivo`}
              action={
                <>
                  <Button onClick={() => baixar('xlsx')} disabled={!incluidas.length}>
                    <Download className="h-4 w-4" /> Baixar XLSX
                  </Button>
                  <Button variant="primary" onClick={() => baixar('csv')} disabled={!incluidas.length}>
                    <Download className="h-4 w-4" /> Baixar CSV
                  </Button>
                </>
              }
            />

            <div className="flex flex-wrap gap-6 border-b border-line px-5 py-4 text-sm">
              <span>Receitas <strong className="text-brand-600">{brl(receitas)}</strong></span>
              <span>Despesas <strong className="text-negative">{brl(despesas)}</strong></span>
              <span>Saldo <strong>{brl(receitas - despesas)}</strong></span>
            </div>

            <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                    <th className="w-9 py-3 pl-4 pr-1" />
                    <th className="w-[100px] px-2 py-3 font-medium">Data</th>
                    <th className="w-[130px] px-2 py-3 font-medium">Conta</th>
                    <th className="px-2 py-3 font-medium">Descrição</th>
                    <th className="w-[130px] py-3 pl-2 pr-4 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr
                      key={l.key}
                      className={`border-b border-line/70 last:border-0 ${l.include ? '' : 'opacity-45'}`}
                    >
                      <td className="py-2.5 pl-4 pr-1">
                        <input
                          type="checkbox" checked={l.include} onChange={() => alternar(l.key)}
                          className="h-4 w-4 cursor-pointer accent-brand-500"
                          aria-label={`Incluir ${l.description}`}
                        />
                      </td>
                      <td className="tabnum whitespace-nowrap px-2 py-2.5 text-ink-soft">{dateBR(l.date)}</td>
                      <td className="px-2 py-2.5"><Badge>{l.accountName}</Badge></td>
                      <td className="px-2 py-2.5">
                        <span className="flex items-center gap-1.5">
                          {l.parDe && (
                            <span title="Transferência entre contas">
                              <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                            </span>
                          )}
                          <span className="truncate" title={l.description}>{l.description}</span>
                        </span>
                      </td>
                      <td className={`tabnum whitespace-nowrap py-2.5 pl-2 pr-4 text-right font-medium ${l.type === 'receita' ? 'text-brand-600' : 'text-negative'}`}>
                        {l.type === 'receita' ? '+' : '−'} {brl(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="border-t border-line px-5 py-3 text-xs text-ink-muted">
              A coluna Categoria sai em branco de propósito: as regras automáticas classificam na
              hora da importação, e o que sobrar você ajusta na tela de revisão do Importar extrato.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
