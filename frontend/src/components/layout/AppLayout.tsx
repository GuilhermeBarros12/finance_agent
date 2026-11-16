import { BookOpen, Briefcase, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { SignOutButton } from '@/features/auth/components/SignOutButton'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'

const LINKS = [
  { to: '/', label: 'Conversas', Icon: MessageSquare, end: true },
  { to: '/carteira', label: 'Carteira', Icon: Briefcase, end: false },
  { to: '/dados', label: 'Dados', Icon: BookOpen, end: false },
]

function linkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex min-h-11 flex-1 items-center justify-center gap-2 px-3 text-rotulo md:flex-none md:justify-start md:rounded-selo',
    isActive ? 'font-semibold text-azul-caneta underline decoration-2 underline-offset-8' : 'text-tinta',
  )
}

export function AppLayout() {
  const [signOutError, setSignOutError] = useState<string | null>(null)
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14rem_1fr]">
      <aside className="hidden border-r border-borda bg-superficie p-4 md:block">
        <p className="font-serif text-subtitulo font-semibold">Agente de Investimentos</p>
        <nav aria-label="Principal" className="mt-6 flex flex-col gap-1">
          {LINKS.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon aria-hidden="true" className="size-5" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 flex flex-col items-start gap-2">
          <ThemeToggle />
          <SignOutButton onError={setSignOutError} />
        </div>
      </aside>
      <div className="flex min-h-dvh flex-col pb-14 md:pb-0">
        <header className="flex items-center justify-between border-b border-borda bg-superficie px-4 py-2 md:hidden">
          <p className="font-serif text-rotulo font-semibold">Agente de Investimentos</p>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <SignOutButton onError={setSignOutError} />
          </div>
        </header>
        <div aria-live="assertive">
          {signOutError ? (
            <p role="alert" className="border-b border-carmim px-4 py-2 text-carmim">
              {signOutError}
            </p>
          ) : null}
        </div>
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
        <footer className="border-t border-borda px-4 py-3 text-nota text-tinta-suave">
          <Link to="/aviso-legal" className="inline-flex min-h-11 items-center underline">
            Aviso legal
          </Link>
        </footer>
      </div>
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 flex border-t border-borda bg-superficie md:hidden"
      >
        {LINKS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            <Icon aria-hidden="true" className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
