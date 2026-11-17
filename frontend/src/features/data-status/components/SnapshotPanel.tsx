import { AlertTriangle, CheckCircle2, CircleHelp, DatabaseZap, TriangleAlert } from 'lucide-react'
import { EmptyState } from '@/components/state'
import { FreshnessBadge, StatusBadge } from '@/components/status'
import { VALIDATION_STATUSES, type Catalog, type CatalogSnapshot } from '@/features/chat/contracts'
import { DateTime } from '@/features/chat/components/DateTime'
import { formatDateTime } from '@/features/chat/dates'
import { sourceName, isKnownSource } from '@/features/chat/safeLink'
import { cn } from '@/lib/utils'

// Tudo vem pronto do catálogo (GET /catalog): o navegador não recalcula frescor, não soma
// contagens e não calcula idade. Textos do servidor entram só como texto (React escapa).

const TICKER = /^[A-Z0-9]{1,12}$/

function Ticker({ id }: { id: string }) {
  return <span className={TICKER.test(id) ? 'whitespace-nowrap' : '[overflow-wrap:anywhere]'}>{id}</span>
}

function FreshnessNotice({ status }: { status: CatalogSnapshot['freshness'] }) {
  if (status === 'fresh') return null
  const text =
    status === 'stale'
      ? 'Dados desatualizados: confira a data antes de usar.'
      : status === 'expired'
        ? 'Dados vencidos: não use como atuais. Aguarde uma nova coleta.'
        : 'A data-base do lote não é conhecida: não dá para dizer se os dados estão atualizados.'
  return (
    <p className={cn('mt-3 flex items-start gap-2 font-medium', status === 'expired' ? 'text-carmim' : 'text-ambar-alerta')}>
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function StatusCounts({ counts }: { counts: Record<string, number> | null }) {
  if (counts === null) {
    return (
      <p className="flex items-start gap-2 text-tinta-suave">
        <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>A contagem de campos por estado não está disponível neste lote.</span>
      </p>
    )
  }
  const known = VALIDATION_STATUSES.map((status) => ({ status, count: counts[status] }))
  const unknown = Object.keys(counts)
    .filter((key) => !(VALIDATION_STATUSES as readonly string[]).includes(key))
    .sort()
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 min-[560px]:grid-cols-2">
      {known.map(({ status, count }) => (
        <li key={status} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-borda py-2">
          <StatusBadge status={status} />
          <span>{count === undefined ? 'não informado' : plural(count, 'campo', 'campos')}</span>
        </li>
      ))}
      {unknown.map((key) => (
        <li key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-borda py-2">
          <span className="inline-flex min-w-0 items-center gap-1 rounded-selo border border-dotted border-tinta-suave px-2 py-0.5 text-nota font-medium text-tinta-suave">
            <CircleHelp aria-hidden="true" className="size-4 shrink-0" />
            <span className="[overflow-wrap:anywhere]">Estado não reconhecido: {key}</span>
          </span>
          <span>{plural(counts[key], 'campo', 'campos')}</span>
        </li>
      ))}
    </ul>
  )
}

function Failures({ failures, catalog }: { failures: CatalogSnapshot['failures']; catalog: Catalog }) {
  if (failures === null) {
    return (
      <p className="flex items-start gap-2 text-tinta-suave">
        <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>A lista de falhas não está disponível neste lote.</span>
      </p>
    )
  }
  if (failures.length === 0) {
    return (
      <p className="flex items-start gap-2">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>Nenhuma falha registrada neste lote.</span>
      </p>
    )
  }
  return (
    <>
      <p className="mb-2 text-tinta-suave">{plural(failures.length, 'falha registrada', 'falhas registradas')} neste lote.</p>
      <ul className="divide-y divide-borda rounded-painel border border-borda bg-superficie">
        {failures.map((failure, index) => {
          const name = catalog.assets.find((a) => a.asset_id === failure.asset_id)?.name
          return (
            <li key={`${failure.asset_id}-${failure.source_id}-${index}`} className="min-w-0 p-4">
              <p className="flex min-w-0 items-start gap-2 font-semibold">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <span className="min-w-0">
                  <Ticker id={failure.asset_id} />
                  {name ? <span className="font-normal text-tinta-suave [overflow-wrap:anywhere]"> {name}</span> : null}
                </span>
              </p>
              <dl className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-1 min-[480px]:grid-cols-[auto_minmax(0,1fr)]">
                <dt className="text-tinta-suave">Fonte</dt>
                <dd className="min-w-0">
                  <span className={isKnownSource(failure.source_id) ? 'whitespace-nowrap' : '[overflow-wrap:anywhere]'}>
                    {sourceName(failure.source_id)}
                  </span>
                </dd>
                <dt className="text-tinta-suave">Motivo</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{failure.reason}</dd>
              </dl>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function SnapshotPanel({ catalog }: { catalog: Catalog }) {
  const { snapshot } = catalog
  if (snapshot === null) {
    return (
      <EmptyState
        icon={<DatabaseZap className="size-5" />}
        title="Ainda não há dados coletados"
        description="Quando a primeira coleta for publicada, o estado do lote aparece aqui."
      />
    )
  }
  const collected = formatDateTime(snapshot.collected_at)
  return (
    <div className="min-w-0 space-y-6">
      <section aria-labelledby="lote-titulo" className="min-w-0 rounded-painel border border-borda bg-superficie p-4">
        <h2 id="lote-titulo" className="text-subtitulo">
          Último lote de dados
        </h2>
        <p className="mt-2">
          Coletado em{' '}
          {collected === 'data inválida' ? (
            collected
          ) : (
            <time dateTime={snapshot.collected_at}>
              <DateTime iso={snapshot.collected_at} />
            </time>
          )}{' '}
          <span className="text-tinta-suave">(horário de Brasília)</span>
        </p>
        <p className="mt-1 text-rotulo">
          {snapshot.assets_updated} de {snapshot.assets_total} ativos atualizados
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <FreshnessBadge status={snapshot.freshness} />
          <span className="text-nota text-tinta-suave">estado atual do lote</span>
        </div>
        <FreshnessNotice status={snapshot.freshness} />
        <p className="mt-3 text-nota text-tinta-suave">
          {catalog.universe_version === null
            ? 'Versão da lista de ações: não informada.'
            : <>Versão da lista de ações: <span className="[overflow-wrap:anywhere]">{catalog.universe_version}</span>.</>}
        </p>
      </section>

      <section aria-labelledby="contagem-titulo" className="min-w-0">
        <h2 id="contagem-titulo" className="text-subtitulo">
          Campos por estado de validação
        </h2>
        <p className="mb-2 mt-2 max-w-prose text-tinta-suave">Contagem de campos validados neste lote, como o servidor informou.</p>
        <StatusCounts counts={snapshot.status_counts} />
      </section>

      <section aria-labelledby="falhas-titulo" className="min-w-0">
        <h2 id="falhas-titulo" className="mb-2 text-subtitulo">
          Falhas de coleta
        </h2>
        <Failures failures={snapshot.failures} catalog={catalog} />
      </section>
    </div>
  )
}
