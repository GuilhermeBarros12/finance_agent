import { ExternalLink as ExternalLinkIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { safeSourceUrl } from '@/features/chat/safeLink'

// Link para fora do app: só https em domínio de fonte conhecido (safeSourceUrl), nova aba,
// rel seguro. Endereço fora da lista aparece como texto, sem link.
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const safe = safeSourceUrl(href)
  if (!safe) {
    return (
      <span>
        {children} <span className="text-tinta-suave">(link indisponível)</span>
      </span>
    )
  }
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 text-azul-caneta underline"
    >
      {children}
      <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  )
}
