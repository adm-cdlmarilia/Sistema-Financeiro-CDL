import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const brl = (v: number | null | undefined) =>
  `R$ ${Number(v ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export const brlShort = (v: number) => {
  const n = Math.abs(v)
  if (n >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`
  return brl(v)
}

/** Datas do banco vêm como 'YYYY-MM-DD' — sem fuso, para não deslocar o dia. */
export const toDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

export const dateBR = (iso?: string | null) => (iso ? format(toDate(iso), 'dd/MM/yyyy') : '—')

export const monthLabel = (iso: string) =>
  format(toDate(iso), "MMMM 'de' yyyy", { locale: ptBR })

export const monthShort = (iso: string) => format(toDate(iso), 'MMM/yy', { locale: ptBR })

export const dateTimeBR = (iso: string) => format(parseISO(iso), "dd/MM/yyyy 'às' HH:mm")

export const firstDayOfMonth = (ym: string) => `${ym}-01`

export const lastDayOfMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return format(new Date(y, m, 0), 'yyyy-MM-dd')
}

export const currentMonth = () => format(new Date(), 'yyyy-MM')
