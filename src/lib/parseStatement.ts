import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedRow {
  date: string // YYYY-MM-DD
  description: string
  amount: number // absoluto
  type: 'receita' | 'despesa'
  rawAmount: number
  accountName: string
  categoryName: string
  account_id?: string | null
  category_id?: string | null
  include: boolean
}

export interface ParseResult {
  rows: ParsedRow[]
  skipped: number
  headers: string[]
  fileHash: string
}

/** Colunas obrigatórias do arquivo, na ordem em que são procuradas. */
const HINTS = {
  data: ['data', 'date', 'dt', 'vencimento', 'lancamento', 'lançamento', 'competencia'],
  conta: ['conta', 'account', 'banco', 'bank'],
  tipo: ['tipo', 'type', 'natureza', 'entrada/saida', 'd/c'],
  categoria: ['categoria', 'category', 'classificacao', 'classificação', 'plano de contas'],
  valor: ['valor', 'amount', 'montante', 'quantia', 'credito', 'crédito', 'debito', 'débito'],
  descricao: ['descri', 'historic', 'histórico', 'detalhe', 'detail', 'memo',
              'operacao', 'operação', 'nome', 'favorecido', 'transaction'],
}

const norm = (s: unknown) =>
  String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Acha a coluna pelos termos, ignorando as que já foram usadas por outro campo. */
function findColumn(headers: string[], hints: string[], used: Set<number>, exclude: string[] = []) {
  const h = headers.map(norm)
  for (const hint of hints) {
    const i = h.findIndex(
      (x, idx) => !used.has(idx) && x.includes(norm(hint)) && !exclude.some((e) => x.includes(norm(e))),
    )
    if (i !== -1) { used.add(i); return i }
  }
  return -1
}

/** Aceita 31/12/2026, 2026-12-31, 31-12-2026 e datas nativas do Excel. */
export function parseDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(value ?? '').trim()
  if (!s) return null

  if (s.includes('/')) {
    const p = s.split('/')
    if (p.length !== 3) return null
    let [a, b, y] = p
    let day = a, month = b
    if (Number(a) > 12 && Number(b) <= 12) { day = a; month = b }
    else if (Number(b) > 12 && Number(a) <= 12) { day = b; month = a }
    if (y.length === 2) y = `20${y}`
    return `${y.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  if (s.includes('-')) {
    const p = s.split('-')
    if (p.length !== 3) return null
    if (p[0].length === 4) return s.slice(0, 10)
    return `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`
  }
  return null
}

/** Aceita "R$ 1.234,56", "-150,50", "(150.50)", "1234.56". */
export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value
  let s = String(value ?? '').trim()
  if (!s) return 0
  const negative = s.includes('-') || s.startsWith('(')
  s = s.replace(/[R$\s]/gi, '').replace(/[-()]/g, '').replace(/[^\d,.]/g, '')

  if (s.includes('.') && s.includes(',')) {
    s = s.indexOf(',') > s.indexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  } else if (s.includes('.')) {
    const parts = s.split('.')
    if (parts.length > 1 && parts[parts.length - 1].length === 3) s = s.replace(/\./g, '')
  }
  const n = parseFloat(s) || 0
  return negative ? -Math.abs(n) : n
}

/** "receita", "entrada", "crédito", "C" → receita; o resto que indicar saída → despesa. */
export function parseType(value: unknown, fallbackAmount: number): 'receita' | 'despesa' {
  const t = norm(value)
  if (!t) return fallbackAmount >= 0 ? 'receita' : 'despesa'
  if (/^(receita|entrada|credito|credit|c|\+)$/.test(t) || t.startsWith('receit') || t.startsWith('entrad') || t.startsWith('credit')) {
    return 'receita'
  }
  if (/^(despesa|saida|debito|debit|d|-)$/.test(t) || t.startsWith('despes') || t.startsWith('said') || t.startsWith('debit')) {
    return 'despesa'
  }
  return fallbackAmount >= 0 ? 'receita' : 'despesa'
}

async function hashFile(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return `${file.name}-${file.size}-${file.lastModified}`
  }
}

function buildRows(matrix: any[][]): { rows: ParsedRow[]; skipped: number; headers: string[] } {
  if (!matrix.length) throw new Error('Arquivo vazio.')
  const headers = (matrix[0] ?? []).map((h) => String(h ?? ''))

  // ordem importa: os campos mais específicos primeiro, descrição por último
  const used = new Set<number>()
  const iDate = findColumn(headers, HINTS.data, used)
  const iAccount = findColumn(headers, HINTS.conta, used)
  const iType = findColumn(headers, HINTS.tipo, used)
  const iCat = findColumn(headers, HINTS.categoria, used)
  const iAmount = findColumn(headers, HINTS.valor, used, ['saldo'])
  const iDesc = findColumn(headers, HINTS.descricao, used)

  const missing: string[] = []
  if (iDate === -1) missing.push('Data')
  if (iAccount === -1) missing.push('Conta')
  if (iDesc === -1) missing.push('Descrição')
  if (iAmount === -1) missing.push('Valor')
  if (iType === -1) missing.push('Tipo')
  if (iCat === -1) missing.push('Categoria')

  if (missing.length) {
    throw new Error(
      `Faltam as colunas: ${missing.join(', ')}.\n\n` +
        `Cabeçalhos lidos no arquivo: ${headers.filter(Boolean).join(', ') || '(nenhum)'}\n\n` +
        `O arquivo precisa ter as seis colunas: Data, Conta, Descrição, Valor, Tipo e Categoria.`,
    )
  }

  const rows: ParsedRow[] = []
  let skipped = 0

  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? []
    if (!cells.length || cells.every((c) => String(c ?? '').trim() === '')) continue

    const date = parseDate(cells[iDate])
    const description = String(cells[iDesc] ?? '').trim()
    const rawAmount = parseAmount(cells[iAmount])

    if (!date || !description || rawAmount === 0) { skipped++; continue }

    rows.push({
      date,
      description,
      amount: Math.abs(rawAmount),
      rawAmount,
      type: parseType(cells[iType], rawAmount),
      accountName: String(cells[iAccount] ?? '').trim(),
      categoryName: String(cells[iCat] ?? '').trim(),
      include: true,
    })
  }

  if (!rows.length) throw new Error('Nenhuma transação válida encontrada no arquivo.')
  return { rows, skipped, headers }
}

export async function parseStatementFile(file: File): Promise<ParseResult> {
  const fileHash = await hashFile(file)
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text()
    const delimiter = (text.split('\n')[0] ?? '').includes(';') ? ';' : ','
    const parsed = Papa.parse<string[]>(text.trim(), { delimiter, skipEmptyLines: true })
    const matrix = (parsed.data as any[][]).map((r) =>
      r.map((c) => String(c ?? '').replace(/^["']|["']$/g, '').trim()),
    )
    return { ...buildRows(matrix), fileHash }
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const matrix = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '', raw: true })
    return { ...buildRows(matrix), fileHash }
  }

  throw new Error('Formato não suportado. Envie um arquivo CSV ou XLSX.')
}

/** Compara nomes ignorando maiúsculas, acentos e espaços sobrando. */
export const sameName = (a: string, b: string) => norm(a) === norm(b)

/** Exporta uma lista de transações — mesmas seis colunas que o importador aceita. */
export function exportTransactions(
  rows: { date: string; description: string; amount: number; type: string; category?: string; account?: string; source?: string }[],
  fileName: string,
  formatType: 'xlsx' | 'csv',
) {
  const header = ['Data', 'Conta', 'Descrição', 'Valor', 'Tipo', 'Categoria', 'Fonte']
  const body = rows.map((r) => [
    r.date.split('-').reverse().join('/'),
    r.account ?? '',
    r.description,
    (r.type === 'despesa' ? -Math.abs(r.amount) : Math.abs(r.amount)).toFixed(2).replace('.', ','),
    r.type,
    r.category ?? '',
    r.source ?? '',
  ])

  if (formatType === 'csv') {
    const csv = [header, ...body].map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName}.csv`
    a.click()
    URL.revokeObjectURL(url)
    return
  }

  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 48 }, { wch: 14 }, { wch: 10 }, { wch: 28 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Transações')
  XLSX.writeFile(wb, `${fileName}.xlsx`)
}
