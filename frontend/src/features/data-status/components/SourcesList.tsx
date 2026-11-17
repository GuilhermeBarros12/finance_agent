import { CheckCircle2, MinusCircle } from 'lucide-react'
import { ExternalLink } from '@/features/legal/components/ExternalLink'
import { formatReference } from '@/features/chat/dates'
import { SOURCES } from '../sources'
import { PermissionBadge } from './PermissionBadge'

// Estado de permissão registrado de cada fonte: texto fixo do front (sources.ts), não vem
// do servidor.
export function SourcesList() {
  return (
    <section aria-labelledby="fontes-titulo" className="min-w-0">
      <h2 id="fontes-titulo" className="text-subtitulo">
        Fontes e permissão de coleta
      </h2>
      <p className="mt-2 max-w-prose text-tinta-suave">
        Estado de permissão registrado para cada fonte. &quot;Indefinida&quot; quer dizer que a permissão não foi
        comprovada; a fonte só está habilitada por decisão do autor.
      </p>
      <ul className="mt-4 divide-y divide-borda rounded-painel border border-borda bg-superficie">
        {SOURCES.map((source) => (
          <li key={source.id} className="min-w-0 p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">
                <ExternalLink href={source.baseUrl}>{source.name}</ExternalLink>
              </span>
              <PermissionBadge status={source.permission} />
            </div>
            <p className="mt-1 text-nota text-tinta-suave">Fornece {source.provides}.</p>
            <p className="mt-2 max-w-prose">{source.note}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-nota text-tinta-suave">
              <span className="inline-flex items-center gap-1">
                {source.enabled ? (
                  <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
                ) : (
                  <MinusCircle aria-hidden="true" className="size-4 shrink-0" />
                )}
                {source.enabled ? 'Coleta habilitada' : 'Coleta desabilitada'}
              </span>
              <span>
                Registro de <time dateTime={source.reviewedAt}>{formatReference(source.reviewedAt)}</time>
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
