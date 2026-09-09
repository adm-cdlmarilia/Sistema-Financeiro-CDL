import { supabase } from '@/lib/supabase'

export const BUCKET = 'comprovantes'
export const MAX_BYTES = 10 * 1024 * 1024

/** Extensão por tipo de arquivo — a mesma lista aceita pelo bucket no 0005. */
const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'

/**
 * Envia o comprovante e devolve o caminho dele dentro do bucket — é esse
 * caminho que fica gravado em transactions.attachment_url, não uma URL.
 * O bucket é privado, então o endereço só existe no momento de abrir.
 */
export async function enviarComprovante(file: File): Promise<string> {
  const ext = EXTENSAO[file.type]
  if (!ext) throw new Error('Formato não aceito. Envie PDF, JPG, PNG ou WEBP.')
  if (file.size > MAX_BYTES) throw new Error('Arquivo muito grande. O limite é 10 MB.')

  const path = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

/**
 * Abre o comprovante numa aba nova, por link assinado de 1 minuto.
 *
 * A aba é aberta ANTES do await de propósito: o navegador só deixa abrir
 * janela enquanto enxerga o clique do usuário, e depois de uma espera ele
 * trata a chamada como pop-up e bloqueia.
 */
export async function abrirComprovante(path: string) {
  const aba = window.open('', '_blank')
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
    if (error) throw error
    if (aba) aba.location.href = data.signedUrl
    else window.location.href = data.signedUrl
  } catch (e) {
    aba?.close()
    throw e
  }
}
