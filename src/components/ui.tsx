import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={clsx(
        'rounded-card border border-line bg-surface shadow-card',
        'transition-shadow duration-200',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-sm leading-snug text-ink-soft">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'outline', size = 'md', className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium',
        'transition-[background-color,box-shadow,transform] duration-150',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-[0.8125rem]' : 'h-10 px-4 text-sm',
        variant === 'primary' &&
          'bg-brand-500 text-white shadow-card hover:bg-brand-600',
        variant === 'outline' &&
          'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-page',
        variant === 'ghost' && 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
        variant === 'danger' && 'bg-negative text-white shadow-card hover:brightness-110',
        className,
      )}
    />
  )
}

const fieldBase =
  'w-full rounded-lg border border-line bg-surface text-sm text-ink transition-colors ' +
  'placeholder:text-ink-muted hover:border-line-strong ' +
  'focus:border-brand-500 focus:outline-hidden focus:ring-4 focus:ring-brand-100/60 ' +
  'disabled:bg-surface-sunken disabled:text-ink-muted'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(fieldBase, 'h-10 px-3', className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx(fieldBase, 'h-10 cursor-pointer px-3 pr-8', className)}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'receita' | 'despesa' | 'info' | 'atencao'
  children: ReactNode
}) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tone === 'neutral' && 'bg-surface-sunken text-ink-soft ring-line',
        tone === 'receita' && 'bg-brand-50 text-brand-700 ring-brand-100',
        tone === 'despesa' && 'bg-negative-soft text-negative ring-negative/15',
        tone === 'info' && 'bg-[#f2f0ff] text-[#3b2f86] ring-[#ded9f7]',
        tone === 'atencao' && 'bg-attention-soft text-attention ring-attention/20',
      )}
    >
      {children}
    </span>
  )
}

export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 backdrop-blur-[2px] animate-fade-in sm:p-8"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'w-full rounded-card border border-line bg-surface shadow-float animate-slide-up',
          wide ? 'max-w-4xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            aria-label="Fechar"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-16 text-center">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-muted">{hint}</p>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'animate-pulse rounded-lg bg-linear-to-r from-surface-sunken via-line/50 to-surface-sunken',
        className,
      )}
    />
  )
}
