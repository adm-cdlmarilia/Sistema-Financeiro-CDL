import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'
import NewPassword from '@/pages/NewPassword'
import ConfigError from '@/pages/ConfigError'
import { supabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

// cada página carrega sob demanda — o primeiro acesso não baixa o app inteiro
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Transactions = lazy(() => import('@/pages/Transactions'))
const Prepare = lazy(() => import('@/pages/Prepare'))
const Import = lazy(() => import('@/pages/Import'))
const Reports = lazy(() => import('@/pages/Reports'))
const Categories = lazy(() => import('@/pages/Categories'))
const Accounts = lazy(() => import('@/pages/Accounts'))
const Logs = lazy(() => import('@/pages/Logs'))

const Loader = () => (
  <div className="flex h-64 items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-brand-500" />
  </div>
)

export default function App() {
  const { session, loading, recovering } = useAuth()

  if (!supabaseConfigured) return <ConfigError />

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-line border-t-brand-500" />
      </div>
    )
  }

  if (recovering) return <NewPassword />
  if (!session) return <Login />

  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/preparar" element={<Prepare />} />
          <Route path="/importar" element={<Import />} />
          <Route path="/transacoes" element={<Transactions />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/categorias" element={<Categories />} />
          <Route path="/contas" element={<Accounts />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
