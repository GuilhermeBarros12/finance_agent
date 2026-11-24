import type { ReactNode } from 'react'
import { LegalFooter } from './LegalFooter'

// Moldura das telas fora do AppLayout (entrar, verificação de sessão e de acesso, aviso
// legal): conteúdo e, no fim da página, o rodapé com o link do aviso legal.
export function ScreenFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className={`flex-1 p-4 md:p-8 ${className}`}>{children}</main>
      <LegalFooter />
    </div>
  )
}
