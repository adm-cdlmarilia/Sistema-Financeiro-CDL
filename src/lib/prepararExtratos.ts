import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { RawRow } from '@/lib/parseStatement'

export interface LinhaPreparada {
  key: string
  date: string
  description: string
  amount: number
  type: 'receita' | 'despesa'
  accountName: string
  /** Chave da linha do outro lado, quando a transação é transferência interna. */
  parDe: string | null
  /** Desmarcada não vai para o arquivo final. */
  include: boolean
}

/** Junta os extratos já lidos, carimbando a conta escolhida para cada um. */
export function unificar(fontes: { accountName: string; rows: RawRow[] }[]): LinhaPreparada[] {
  const linhas = fontes.flatMap((fonte, iFonte) =>
    fonte.rows.map((r, iLinha) => ({
      key: `${iFonte}-${iLinha}`,
      date: r.date,
      description: r.description,
      amount: r.amount,
      type: r.type,
      accountName: fonte.accountName,
      parDe: null,
      include: true,
    })),
  )
  return linhas.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)))
}

/**
 * Marca as transferências entre as contas da própria CDL.
 *
 * Um PIX de R$ 500 da Cresol para a Cora aparece duas vezes: como saída
 * num extrato e como entrada no outro. Nenhuma das duas é despesa ou
 * receita de verdade — é o mesmo dinheiro mudando de lugar —, então as
 * duas pontas saem do arquivo final, senão o total do mês conta duas vezes.
 *
 * O pareamento exige valor igual, contas diferentes, sentidos opostos e
 * datas próximas (bancos levam de um a três dias para compensar). Cada
 * linha só pode ser usada uma vez, e entre os candidatos vence o de data
 * mais próxima.
 */
export function marcarTransferencias(linhas: LinhaPreparada[], toleranciaDias: number): LinhaPreparada[] {
  const resultado = linhas.map((l) => ({ ...l, parDe: null as string | null, include: true }))
  const usadas = new Set<string>()

  const saidas = resultado.filter((l) => l.type === 'despesa')
  const entradas = resultado.filter((l) => l.type === 'receita')

  for (const saida of saidas) {
    if (usadas.has(saida.key)) continue

    let melhor: LinhaPreparada | null = null
    let melhorDistancia = Infinity

    for (const entrada of entradas) {
      if (usadas.has(entrada.key)) continue
      if (entrada.accountName === saida.accountName) continue
      if (Math.abs(entrada.amount - saida.amount) > 0.005) continue

      const distancia = Math.abs(differenceInCalendarDays(parseISO(entrada.date), parseISO(saida.date)))
      if (distancia > toleranciaDias) continue

      if (distancia < melhorDistancia) { melhor = entrada; melhorDistancia = distancia }
    }

    if (melhor) {
      usadas.add(saida.key)
      usadas.add(melhor.key)
      saida.parDe = melhor.key
      melhor.parDe = saida.key
      saida.include = false
      melhor.include = false
    }
  }

  return resultado
}
