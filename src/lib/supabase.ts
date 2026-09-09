import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string) ?? ''
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? ''

/** Falso quando o .env está ausente ou incompleto — o App mostra uma tela explicando. */
export const supabaseConfigured = Boolean(url.startsWith('http') && key.length > 20)

if (!supabaseConfigured) {
  console.warn(
    '[CDL] Variáveis de ambiente ausentes. Crie o arquivo .env na raiz do projeto com ' +
      'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY, e reinicie o servidor (npm run dev).',
  )
}

// valores de reserva evitam que o createClient derrube a página inteira
export const supabase = createClient(
  supabaseConfigured ? url : 'https://placeholder.supabase.co',
  supabaseConfigured ? key : 'placeholder-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)

export type Role = 'admin' | 'lancador' | 'leitura'

export interface Profile {
  id: string
  email: string | null
  full_name: string | null
  role: Role
}

export interface Account {
  id: string
  name: string
  bank: string | null
  opening_balance: number
  color: string | null
  is_active: boolean
}

export interface Category {
  id: string
  name: string
  kind: 'receita' | 'despesa' | 'ambos'
  color: string | null
  is_active: boolean
}

export interface CategoryRule {
  id: string
  pattern: string
  is_regex: boolean
  category_id: string
  priority: number
  is_active: boolean
  categories?: { name: string } | null
}

export interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  type: 'receita' | 'despesa'
  category_id: string | null
  account_id: string | null
  import_id: string | null
  source: 'manual' | 'upload'
  attachment_url: string | null
  notes: string | null
  reconciled: boolean
  categories?: { name: string } | null
  accounts?: { name: string } | null
}

export interface StatementImport {
  id: string
  file_name: string
  format: string | null
  account_id: string | null
  period_start: string | null
  period_end: string | null
  rows_total: number
  rows_imported: number
  rows_duplicated: number
  status: string
  created_at: string
  accounts?: { name: string } | null
}

export interface ActivityLog {
  id: string
  entity_type: string
  entity_ids: string[]
  action_type: string
  previous_data: any
  description: string | null
  details: string | null
  reverted: boolean
  created_at: string
}
