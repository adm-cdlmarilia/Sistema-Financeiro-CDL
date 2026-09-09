import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button, Input, Field } from '@/components/ui'

/** Tela mostrada quando o usuário chega pelo link de "esqueci minha senha". */
export default function NewPassword() {
  const { updatePassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.')
    if (password !== confirm) return setError('As duas senhas não são iguais.')
    setBusy(true)
    try {
      await updatePassword(password)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page p-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
        <h1 className="text-center text-xl font-semibold">Definir nova senha</h1>
        <p className="mt-1 text-center text-sm text-ink-soft">Escolha uma senha de pelo menos 6 caracteres.</p>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-negative/20 bg-negative-soft px-3 py-2 text-sm text-negative">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <Field label="Nova senha">
            <Input type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Repita a nova senha">
            <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar senha'}
          </Button>
        </form>
      </div>
    </div>
  )
}
