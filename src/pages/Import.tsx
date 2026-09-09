import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UploadCloud, FileSpreadsheet, AlertTriangle, CheckCircle2, Undo2 } from 'lucide-react'
import { supabase, Category, Account, StatementImport } from '@/lib/supabase'
import { parseStatementFile, ParsedRow, sameName } from '@/lib/parseStatement'
import { brl, dateBR, dateTimeBR } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { Button, Card, CardHeader, Select, Badge, EmptyState, Field, Input } from '@/components/ui'

export default function Import() {
  const qc = useQueryClient()
  const { canWrite } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [rows, setRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [fileHash, setFileHash] = useState('')
  const [fileFormat, setFileFormat] = useState<'csv' | 'xlsx'>('csv')
  const [fallbackAccount, setFallbackAccount] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ imported: number } | null>(null)
  const [busy, setBusy] = useState(false)

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
      const { data, error } = await supabase.from('accounts').select('*').eq('is_active', true).order('name')
      if (error) throw error
      return data as Account[]
    },
  })

  const { data: history } = useQuery({
    queryKey: ['imports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('statement_imports')
        .select('*, accounts(name)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as StatementImport[]
    },
  })

  async function handleFile(file: File) {
    setError(''); setResult(null); setBusy(true)
    try {
      const parsed = await parseStatementFile(file)
      setFileName(file.name)
      setFileHash(parsed.fileHash)
      setFileFormat(file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx')

      // regras de categorização, usadas só quando a categoria do arquivo não bate com nenhuma cadastrada
      const { data: rules } = await supabase
        .from('category_rules')
        .select('pattern, category_id, priority, is_active')
        .eq('is_active', true)
        .order('priority')

      const marked = parsed.rows.map((r) => {
        const account = (accounts ?? []).find((a) => sameName(a.name, r.accountName))
        const category = (categories ?? []).find((c) => sameName(c.name, r.categoryName))

        // a categoria do arquivo manda: se não existir ainda, fica para ser criada.
        // As regras automáticas só entram quando o arquivo veio sem categoria.
        let category_id = category?.id ?? null
        if (!category_id && !r.categoryName) {
          const d = r.description.toLowerCase()
          category_id = (rules ?? []).find((x: any) => d.includes(String(x.pattern).toLowerCase()))?.category_id ?? null
        }

        return { ...r, include: true, account_id: account?.id ?? null, category_id }
      })

      setRows(marked)
    } catch (e: any) {
      setError(e.message ?? 'Não consegui ler o arquivo.')
      setRows([])
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    const selected = rows.filter((r) => r.include)
    if (!selected.length) return

    const semConta = selected.filter((r) => !r.account_id && !fallbackAccount)
    if (semConta.length) {
      setError(`${semConta.length} linha(s) estão sem conta. Escolha a conta na linha ou defina uma conta padrão acima.`)
      return
    }

    setBusy(true); setError('')
    try {
      // categorias que vieram no arquivo e ainda não existem: são criadas agora
      const nomesNovos = [...new Map(
        selected
          .filter((r) => !r.category_id && r.categoryName)
          .map((r) => [r.categoryName.trim().toLowerCase(), r.categoryName.trim()]),
      ).values()]

      let criadas: Category[] = []
      if (nomesNovos.length) {
        const { error: e1 } = await supabase
          .from('categories')
          .upsert(nomesNovos.map((name) => ({ name, kind: 'ambos' })),
                  { onConflict: 'name', ignoreDuplicates: true })
        if (e1) throw e1

        const { data: todas, error: e2 } = await supabase.from('categories').select('*')
        if (e2) throw e2
        criadas = (todas ?? []) as Category[]

        await supabase.from('activity_logs').insert({
          entity_type: 'Categoria', action_type: 'bulk_create',
          description: `${nomesNovos.length} categoria(s) criada(s) pela importação`,
          details: nomesNovos.join(', ').slice(0, 500),
        })
        qc.invalidateQueries({ queryKey: ['categories'] })
      }

      const resolveCategoria = (r: ParsedRow) => {
        if (r.category_id) return r.category_id
        if (!r.categoryName) return null
        return criadas.find((c) => sameName(c.name, r.categoryName))?.id ?? null
      }

      const { data, error } = await supabase.rpc('import_transactions', {
        p_file_name: fileName,
        p_format: fileFormat,
        p_account: fallbackAccount || null,
        p_file_hash: fileHash,
        p_rows: selected.map((r) => ({
          date: r.date,
          description: r.description,
          amount: r.amount,
          type: r.type,
          category_id: resolveCategoria(r),
          account_id: r.account_id ?? null,
        })),
      })
      if (error) throw error
      setResult({ imported: (data as any).imported })
      setRows([]); setFileName('')
      qc.invalidateQueries({ queryKey: ['imports'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['available-months'] })
      qc.invalidateQueries({ queryKey: ['accounts-balance'] })
    } catch (e: any) {
      setError(e.message ?? 'Erro ao salvar as transações.')
    } finally {
      setBusy(false)
    }
  }

  async function revertImport(id: string, name: string) {
    if (!confirm(`Reverter a importação "${name}"? As transações desse lote serão removidas.`)) return
    const { error } = await supabase.rpc('revert_import', { p_import: id })
    if (error) { alert(error.message); return }
    qc.invalidateQueries({ queryKey: ['imports'] })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
  }

  const included = rows.filter((r) => r.include).length
  const contaNaoReconhecida = rows.filter((r) => r.include && !r.account_id).length

  /** Categorias do arquivo que ainda não existem — serão criadas ao importar. */
  const categoriasNovas = [...new Set(
    rows.filter((r) => r.include && !r.category_id && r.categoryName)
        .map((r) => r.categoryName.trim()),
  )]
  const semCategoriaNenhuma = rows.filter((r) => r.include && !r.category_id && !r.categoryName).length

  const setRow = (i: number, patch: Partial<ParsedRow>) =>
    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar extrato</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Arquivo CSV ou XLSX com as colunas <strong>Data, Conta, Descrição, Valor, Tipo e Categoria</strong>.
          Nada é gravado antes de você revisar.
        </p>
      </div>

      {result && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <CheckCircle2 className="h-5 w-5" />
          {result.imported} transação(ões) importada(s).
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-negative/20 bg-negative-soft px-4 py-3 text-sm text-negative">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {!rows.length && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Novo arquivo" subtitle="CSV ou XLSX com as seis colunas" />
            <div className="p-5">
              <div
                onClick={() => canWrite && fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); if (canWrite && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]) }}
                className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line py-12 text-center transition-colors hover:border-brand-500 hover:bg-brand-50/40 ${!canWrite && 'pointer-events-none opacity-50'}`}
              >
                <UploadCloud className="h-10 w-10 text-ink-muted" />
                <div>
                  <p className="font-medium">{busy ? 'Lendo arquivo...' : 'Arraste o arquivo aqui ou clique para selecionar'}</p>
                  <p className="mt-1 text-sm text-ink-muted">CSV (separado por ponto e vírgula) ou XLSX</p>
                </div>
              </div>
              <input
                ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />

              <div className="mt-5 rounded-lg border border-line bg-surface-page p-4 text-xs">
                <p className="mb-2 font-medium text-ink">Formato esperado</p>
                <pre className="overflow-x-auto text-ink-soft">
{`Data;Conta;Descrição;Valor;Tipo;Categoria
01/07/2026;Cresol;Dízimo recebido;200,00;receita;Dízimos
05/07/2026;Cora;Compra supermercado;-150,50;despesa;Alimentação`}
                </pre>
                <ul className="mt-3 list-disc space-y-1 pl-4 text-ink-soft">
                  <li>Datas em DD/MM/AAAA e valores com vírgula decimal.</li>
                  <li>O nome da conta e da categoria precisa existir no sistema (não diferencia maiúscula nem acento).</li>
                  <li>Tipo aceita receita/despesa, entrada/saída ou crédito/débito.</li>
                </ul>
              </div>

              {!canWrite && <p className="mt-3 text-sm text-ink-muted">Seu acesso é somente leitura.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title={`Histórico de importações (${history?.length ?? 0})`} />
            <div className="max-h-[520px] overflow-y-auto p-3">
              {!history?.length ? (
                <EmptyState title="Nenhum extrato importado ainda" />
              ) : (
                history.map((imp) => (
                  <div key={imp.id} className="flex items-center gap-3 rounded-lg p-3 hover:bg-surface-page">
                    <FileSpreadsheet className="h-5 w-5 shrink-0 text-ink-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{imp.file_name}</p>
                      <p className="text-xs text-ink-muted">
                        {dateTimeBR(imp.created_at)} · {imp.rows_imported} transação(ões)
                      </p>
                    </div>
                    {imp.status === 'revertido' ? (
                      <Badge>revertido</Badge>
                    ) : canWrite ? (
                      <Button size="sm" variant="ghost" onClick={() => revertImport(imp.id, imp.file_name)}>
                        <Undo2 className="h-4 w-4" /> Reverter
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader
            title={`Revisão — ${fileName}`}
            subtitle={`${rows.length} linha(s) lida(s) · ${included} marcada(s) para importar`}
            action={
              <div className="flex gap-2">
                <Button onClick={() => { setRows([]); setFileName(''); setError('') }}>Cancelar</Button>
                <Button variant="primary" disabled={busy || !included} onClick={confirmImport}>
                  {busy ? 'Importando...' : `Importar ${included}`}
                </Button>
              </div>
            }
          />

          {contaNaoReconhecida > 0 && (
            <div className="border-b border-line bg-attention-soft px-5 py-3 text-sm text-attention">
              {contaNaoReconhecida} linha(s) com conta não reconhecida — ajuste na coluna Conta
              ou defina uma conta padrão abaixo.
              {semCategoriaNenhuma > 0 && (
                <span className="mt-1 block">
                  {semCategoriaNenhuma} linha(s) estão sem categoria no arquivo — escolha na própria linha se quiser.
                </span>
              )}
            </div>
          )}

          {categoriasNovas.length > 0 && (
            <div className="border-b border-line bg-brand-50 px-5 py-3 text-sm text-brand-700">
              <p className="font-medium">
                {categoriasNovas.length} categoria(s) nova(s) serão criadas ao importar:
              </p>
              <p className="mt-1 text-brand-600">{categoriasNovas.join(' · ')}</p>
            </div>
          )}

          <div className="grid gap-4 border-b border-line p-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Conta padrão (para linhas sem conta reconhecida)">
              <Select value={fallbackAccount} onChange={(e) => setFallbackAccount(e.target.value)}>
                <option value="">Nenhuma</option>
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Arquivo"><Input value={fileName} readOnly /></Field>
            <div className="flex items-end">
              <Button size="sm" onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: false })))}>
                Desmarcar todas
              </Button>
            </div>
          </div>

          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-3 font-medium">
                    <input
                      type="checkbox" className="h-4 w-4 accent-brand-500"
                      checked={included === rows.length}
                      onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Conta</th>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/70">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox" className="h-4 w-4 accent-brand-500"
                        checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="tabnum whitespace-nowrap px-4 py-2 text-ink-soft">{dateBR(r.date)}</td>
                    <td className="px-4 py-2">
                      <Select
                        className={`h-8 text-xs ${!r.account_id ? 'border-[#e0b884]' : ''}`}
                        value={r.account_id ?? ''}
                        onChange={(e) => setRow(i, { account_id: e.target.value || null })}
                      >
                        <option value="">
                          {r.accountName ? `? ${r.accountName}` : 'Sem conta'}
                        </option>
                        {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </Select>
                    </td>
                    <td className="max-w-[260px] truncate px-4 py-2" title={r.description}>
                      {r.description}
                    </td>
                    <td className={`tabnum whitespace-nowrap px-4 py-2 text-right font-medium ${r.type === 'receita' ? 'text-brand-600' : 'text-negative'}`}>
                      {r.type === 'receita' ? '+' : '−'} {brl(r.amount)}
                    </td>
                    <td className="px-4 py-2">
                      <Select
                        className="h-8 text-xs" value={r.type}
                        onChange={(e) => setRow(i, { type: e.target.value as 'receita' | 'despesa' })}
                      >
                        <option value="receita">receita</option>
                        <option value="despesa">despesa</option>
                      </Select>
                    </td>
                    <td className="px-4 py-2">
                      <Select
                        className={`h-8 text-xs ${!r.category_id && r.categoryName ? 'border-brand-500' : ''}`}
                        value={r.category_id ?? ''}
                        onChange={(e) => setRow(i, { category_id: e.target.value || null })}
                      >
                        <option value="">
                          {r.categoryName ? `+ criar "${r.categoryName}"` : 'Sem categoria'}
                        </option>
                        {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
