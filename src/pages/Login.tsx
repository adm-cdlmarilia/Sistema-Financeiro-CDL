import { useState } from 'react'
import { Eye, EyeOff, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button, Input, Field } from '@/components/ui'

export default function Login() {
  const { signIn, sendReset } = useAuth()
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setMessage(''); setBusy(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
      } else {
        await sendReset(email)
        setMessage('Se esse e-mail estiver cadastrado, o link de redefinição chegará em instantes. Confira também a caixa de spam.')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page p-6">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-8 shadow-card">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
          CDL
        </div>
        <h1 className="mt-5 text-center text-xl font-semibold">Financeiro CDL Marília</h1>
        <p className="mt-1 text-center text-sm text-ink-soft">
          {mode === 'login' ? 'Entre com seu e-mail e senha.' : 'Informe seu e-mail para redefinir a senha.'}
        </p>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-negative/20 bg-negative-soft px-3 py-2 text-sm text-negative">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <Field label="E-mail">
            <Input
              type="email" required autoComplete="username" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@exemplo.com"
            />
          </Field>

          {mode === 'login' && (
            <Field label="Senha">
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  required autoComplete="current-password" className="pr-10"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-muted hover:bg-surface-page"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
          )}

          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Enviar link de redefinição'}
          </Button>
        </form>

        <button
          onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setError(''); setMessage('') }}
          className="mt-4 w-full text-center text-sm text-ink-soft hover:text-ink"
        >
          {mode === 'login' ? 'Esqueci minha senha' : 'Voltar para o login'}
        </button>

        <p className="mt-6 text-center text-xs text-ink-muted">
          Os acessos são criados pelo administrador. Se aparecer “somente leitura”,
          peça a liberação de lançamento.
        </p>
      </div>
    </div>
  )
}
