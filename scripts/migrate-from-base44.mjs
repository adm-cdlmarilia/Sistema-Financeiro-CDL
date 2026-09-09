#!/usr/bin/env node
/**
 * Migração Base44 → Supabase
 *
 * 1) Pegue o token do Base44:
 *    - abra https://financeiro-cdlmarilia.base44.app logado
 *    - F12 → Console → cole:  localStorage.getItem('base44_access_token')
 *    - copie o valor (sem aspas) para BASE44_TOKEN no .env
 * 2) Pegue a service_role key em Supabase → Project Settings → API
 * 3) Rode:  npm run migrate
 *
 * O script é idempotente: transações já migradas (mesma data+descrição+valor)
 * não são inseridas de novo.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

// ---------------------------------------------------------------- env
const env = {}
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const get = (k) => process.env[k] ?? env[k]

const SUPABASE_URL = get('SUPABASE_URL') ?? get('VITE_SUPABASE_URL')
const SERVICE_KEY = get('SUPABASE_SERVICE_ROLE_KEY')
const APP_ID = get('BASE44_APP_ID') ?? '68c06b888d291c998f9d683b'
const TOKEN = get('BASE44_TOKEN')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltou SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const CACHE = 'data'

// ------------------------------------------------------------ base44
async function base44(path) {
  const res = await fetch(`https://base44.app/api/apps/${APP_ID}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!res.ok) throw new Error(`Base44 ${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

async function fetchAll(entity, sort = '-date') {
  const out = []
  for (let skip = 0; ; skip += 5000) {
    const page = await base44(`/entities/${entity}?limit=5000&skip=${skip}&sort=${sort}`)
    out.push(...page)
    process.stdout.write(`\r  ${entity}: ${out.length} registros`)
    if (page.length < 5000) break
  }
  process.stdout.write('\n')
  return out
}

async function loadSource() {
  mkdirSync(CACHE, { recursive: true })
  const cached = `${CACHE}/base44.json`
  if (existsSync(cached)) {
    console.log('→ usando export local em', cached)
    return JSON.parse(readFileSync(cached, 'utf8'))
  }
  if (!TOKEN) {
    console.error('Faltou BASE44_TOKEN no .env (ou coloque o export em data/base44.json)')
    process.exit(1)
  }
  console.log('→ exportando do Base44...')
  const data = {
    transactions: await fetchAll('Transaction', '-date'),
    categories: await fetchAll('Category', 'name'),
    logs: await fetchAll('ActivityLog', '-created_date'),
  }
  writeFileSync(cached, JSON.stringify(data))
  console.log('→ export salvo em', cached)
  return data
}

// ------------------------------------------------------------- main
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

async function main() {
  const src = await loadSource()
  console.log(`\nOrigem: ${src.transactions.length} transações, ${src.categories.length} categorias, ${src.logs.length} logs\n`)

  // 1) categorias — cadastradas + as que só existem dentro das transações
  const names = new Set([
    ...src.categories.map((c) => String(c.name ?? '').trim()).filter(Boolean),
    ...src.transactions.map((t) => String(t.category ?? '').trim()).filter(Boolean),
  ])
  console.log(`1/4 Categorias: ${names.size} nomes distintos`)
  for (const group of chunk([...names], 200)) {
    const { error } = await db.from('categories').upsert(
      group.map((name) => ({ name, kind: 'ambos' })), { onConflict: 'name', ignoreDuplicates: true },
    )
    if (error) throw error
  }

  const { data: cats } = await db.from('categories').select('id, name')
  const catId = new Map(cats.map((c) => [c.name, c.id]))

  // 2) lote de importação por dia (reconstrói o histórico de extratos)
  console.log('2/4 Reconstruindo lotes de importação')
  const byDay = {}
  for (const t of src.transactions) {
    if (t.source !== 'upload') continue
    const day = String(t.created_date ?? '').slice(0, 10)
    if (!day) continue
    ;(byDay[day] ??= []).push(t)
  }
  const importId = {}
  for (const [day, list] of Object.entries(byDay)) {
    const { data, error } = await db.from('statement_imports').insert({
      file_name: `Extrato importado em ${day.split('-').reverse().join('/')} (Base44)`,
      format: 'csv',
      rows_total: list.length,
      rows_imported: list.length,
      status: 'concluido',
      period_start: list.map((t) => t.date).sort()[0],
      period_end: list.map((t) => t.date).sort().slice(-1)[0],
    }).select('id').single()
    if (error) throw error
    importId[day] = data.id
  }
  console.log(`   ${Object.keys(importId).length} lote(s) criado(s)`)

  // 3) transações — sem duplicar o que já está lá
  console.log('3/4 Transações')
  const { data: existing } = await db.from('transactions').select('fingerprint').limit(100000)
  const seen = new Set((existing ?? []).map((t) => t.fingerprint))
  const md5 = (await import('node:crypto')).createHash

  const rows = []
  for (const t of src.transactions) {
    if (!t.date || !t.description) continue
    const amount = Math.abs(Number(t.amount) || 0)
    if (!amount) continue
    const desc = String(t.description).trim()
    // mesma regra da função tx_fingerprint() no banco
    const fp = md5('md5').update(`${t.date.slice(0, 10)}|${desc.toLowerCase()}|${amount.toFixed(2)}`).digest('hex')
    if (seen.has(fp)) continue
    seen.add(fp)
    rows.push({
      date: t.date,
      description: desc,
      amount,
      type: t.type === 'receita' ? 'receita' : 'despesa',
      category_id: catId.get(String(t.category ?? '').trim()) ?? null,
      import_id: t.source === 'upload' ? importId[String(t.created_date ?? '').slice(0, 10)] ?? null : null,
      source: t.source === 'upload' ? 'upload' : 'manual',
      attachment_url: t.attachment_url || null,
      created_at: t.created_date ?? undefined,
    })
  }

  let done = 0
  for (const group of chunk(rows, 500)) {
    const { error } = await db.from('transactions').insert(group)
    if (error) throw error
    done += group.length
    process.stdout.write(`\r   ${done}/${rows.length} inseridas`)
  }
  console.log(`\n   ${rows.length} inseridas · ${src.transactions.length - rows.length} já existiam`)

  // 4) logs históricos
  console.log('4/4 Logs')
  const logRows = src.logs.map((l) => ({
    entity_type: l.entity_type ?? 'Transação',
    action_type: ['create', 'update', 'delete', 'bulk_create', 'bulk_update', 'upload', 'export']
      .includes(l.action_type) ? (l.action_type === 'upload' ? 'import' : l.action_type) : 'update',
    previous_data: (() => { try { return l.previous_data ? JSON.parse(l.previous_data) : null } catch { return null } })(),
    description: l.description ?? null,
    details: l.details ?? null,
    reverted: true, // histórico: não é reversível no sistema novo (ids mudaram)
    created_at: l.created_date ?? undefined,
  }))
  for (const group of chunk(logRows, 500)) {
    const { error } = await db.from('activity_logs').insert(group)
    if (error) throw error
  }
  console.log(`   ${logRows.length} logs migrados`)

  // -------------------------------------------------------- validação
  console.log('\nValidação:')
  const soma = (list, tipo) => list.filter((t) => t.type === tipo)
    .reduce((a, t) => a + Math.abs(Number(t.amount) || 0), 0)
  const origemRec = soma(src.transactions, 'receita')
  const origemDes = soma(src.transactions, 'despesa')

  const { data: check } = await db.rpc('dashboard_summary', {
    p_start: '1900-01-01', p_end: '2999-12-31', p_account: null,
  })
  const destino = check?.[0] ?? {}
  const fmt = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  console.table({
    'Receitas (Base44)': fmt(origemRec),
    'Receitas (Supabase)': fmt(destino.total_receitas ?? 0),
    'Despesas (Base44)': fmt(origemDes),
    'Despesas (Supabase)': fmt(destino.total_despesas ?? 0),
    'Saldo (Base44)': fmt(origemRec - origemDes),
    'Saldo (Supabase)': fmt(destino.saldo_periodo ?? 0),
    'Transações (Base44)': src.transactions.length,
    'Transações (Supabase)': destino.qtd ?? 0,
  })

  const diff = Math.abs((origemRec - origemDes) - Number(destino.saldo_periodo ?? 0))
  console.log(diff < 0.01
    ? '\n✅ Os totais batem. Migração concluída.'
    : `\n⚠️  Diferença de R$ ${fmt(diff)} — confira antes de desligar o Base44.`)

  await db.rpc('refresh_monthly_summary').catch(() => {})
}

main().catch((e) => { console.error('\nErro:', e.message); process.exit(1) })
