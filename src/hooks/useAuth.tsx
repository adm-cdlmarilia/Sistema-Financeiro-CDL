import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, Profile } from '@/lib/supabase'

interface AuthValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  canWrite: boolean
  isAdmin: boolean
  recovering: boolean
  signIn: (email: string, password: string) => Promise<void>
  sendReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthValue>({} as AuthValue)

/** Traduz os erros do Supabase Auth para português. */
function traduzErro(msg: string) {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'E-mail ainda não confirmado. Peça ao administrador para confirmar o cadastro.'
  if (m.includes('too many requests') || m.includes('rate limit')) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
  if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('user not found')) return 'Não encontrei esse e-mail.'
  if (m.includes('new password should be different')) return 'A nova senha precisa ser diferente da atual.'
  return msg
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // link de "esqueci minha senha": abre a tela de definir nova senha
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s)
      if (!s) { setProfile(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    let alive = true
    supabase
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (!alive) return
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
    return () => { alive = false }
  }, [session])

  const value: AuthValue = {
    session,
    profile,
    loading,
    recovering,
    canWrite: profile?.role === 'admin' || profile?.role === 'lancador',
    isAdmin: profile?.role === 'admin',

    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) throw new Error(traduzErro(error.message))
    },

    sendReset: async (email) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: window.location.origin,
      })
      if (error) throw new Error(traduzErro(error.message))
    },

    updatePassword: async (password) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw new Error(traduzErro(error.message))
      setRecovering(false)
    },

    signOut: async () => { await supabase.auth.signOut() },
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
