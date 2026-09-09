import { NavLink, Outlet } from 'react-router-dom'
import {
  BarChart3, Upload, Receipt, FileText, Tag, History, LogOut, Menu, Wallet,
} from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import { useAuth } from '@/hooks/useAuth'

const nav = [
  { to: '/', label: 'Dashboard', icon: BarChart3, end: true },
  { to: '/importar', label: 'Importar extrato', icon: Upload },
  { to: '/transacoes', label: 'Transações', icon: Receipt },
  { to: '/relatorios', label: 'Relatórios', icon: FileText },
  { to: '/categorias', label: 'Categorias', icon: Tag },
  { to: '/contas', label: 'Contas', icon: Wallet },
  { to: '/logs', label: 'Logs de atividade', icon: History },
]

const roleLabel: Record<string, string> = {
  admin: 'Administrador',
  lancador: 'Lançamentos',
  leitura: 'Somente leitura',
}

export default function Layout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-surface-page">
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-surface transition-transform md:translate-x-0 print:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            CDL
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">CDL Marília</p>
            <p className="text-xs text-ink-muted">Gestão financeira</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-soft hover:bg-surface-page',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line p-4">
          <p className="truncate text-sm font-medium">{profile?.full_name ?? profile?.email ?? 'Usuário'}</p>
          <p className="text-xs text-ink-muted">{roleLabel[profile?.role ?? 'leitura']}</p>
          <button
            onClick={signOut}
            className="mt-3 flex items-center gap-2 text-sm text-ink-soft hover:text-ink"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-30 bg-ink/20 md:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col md:ml-64 print:ml-0">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-surface-page">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">CDL Marília</span>
        </header>
        <main className="flex-1 p-4 md:p-8 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
