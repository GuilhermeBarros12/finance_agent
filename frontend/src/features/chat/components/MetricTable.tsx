import { AlertOctagon, AlertTriangle, ChevronDown, ExternalLink, Info } from 'lucide-react'
import { useId, useState, useSyncExternalStore } from 'react'
import { FreshnessBadge, StatusBadge, type FreshnessStatus } from '@/components/status'
import { cn } from '@/lib/utils'
import {
  METRIC_LABEL,
  isMetric,
  type AnswerPayload,
  type Catalog,
  type EvidenceObservation,
  type EvidenceValidation,
} from '../contracts'
import { formatDateTime, formatReference } from '../dates'
import { safeSourceUrl, sourceName } from '../safeLink'
import { warningText } from '../texts'
import { deltaUnit, unitFor } from '../units'
import { Value } from './Value'

// A tabela é montada só com o payload (D21): sem nova chamada ao servidor, sem cálculo.
// A ligação é um JOIN no cliente: seção -> validation_ids -> evidence.validations ->
// observation_ids -> evidence.observations. Cada célula usa só a própria validação.

const SEVERITY: FreshnessStatus[] = ['fresh', 'unknown_reference_date', 'stale', 'expired']

function worstFreshness(validations: EvidenceValidation[]): FreshnessStatus {
  let worst: FreshnessStatus = 'fresh'
  for (const v of validations) if (SEVERITY.indexOf(v.freshness) > SEVERITY.indexOf(worst)) worst = v.freshness
  return worst
}

const WIDE = '(min-width: 768px)'
function useIsWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(WIDE)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE).matches : true),
    () => true,
  )
}

type Resolved = { ok: true; validation: EvidenceValidation; observations: EvidenceObservation[] } | { ok: false }

function makeResolver(payload: AnswerPayload) {
  const validations = new Map(payload.evidence.validations.map((v) => [v.validation_id, v]))
  const observations = new Map(payload.evidence.observations.map((o) => [o.observation_id, o]))
  return (validationId: string, expectedMetric: string | null): Resolved => {
    const validation = validations.get(validationId)
    if (!validation) return { ok: false }
    if (expectedMetric !== null && validation.metric !== expectedMetric) return { ok: false }
    const found: EvidenceObservation[] = []
    for (const id of validation.observation_ids) {
      const o = observations.get(id)
      // Evidência de outro ativo ou de outro indicador não vale para este campo.
      if (!o || o.asset_id !== validation.asset_id || o.metric !== validation.metric) return { ok: false }
      found.push(o)
    }
    const needs = validation.status === 'verified' || validation.status === 'divergent' ? 2 : validation.status === 'single_source' ? 1 : 0
    if (found.length < needs) return { ok: false }
    // Fonte única tem exatamente uma observação; mais de uma é dado inconsistente.
    if (validation.status === 'single_source' && found.length !== 1) return { ok: false }
    if (validation.selected_observation_id && !validation.observation_ids.includes(validation.selected_observation_id)) {
      return { ok: false }
    }
    return { ok: true, validation, observations: found }
  }
}

function IncompleteCell() {
  return (
    <p className="flex items-start gap-2 text-carmim">
      <AlertOctagon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>
        <strong className="font-semibold">Dado incompleto.</strong> A evidência deste campo não veio na resposta, então nenhum valor é mostrado.
      </span>
    </p>
  )
}

function SourceLink({ observation }: { observation: EvidenceObservation }) {
  const name = sourceName(observation.source_id)
  const href = safeSourceUrl(observation.source_url)
  if (!href) {
    return (
      <span>
        {name} <span className="text-tinta-suave">(link indisponível)</span>
      </span>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 text-azul-caneta underline"
    >
      {name}
      <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">(abre em nova aba)</span>
    </a>
  )
}

function ObservationMeta({ observation }: { observation: EvidenceObservation }) {
  return (
    <div className="text-nota text-tinta-suave">
      <div>
        Fonte: <SourceLink observation={observation} />
      </div>
      <div>Coletado em {formatDateTime(observation.collected_at)}</div>
      {observation.reference_at ? <div>Data-base {formatReference(observation.reference_at)}</div> : null}
    </div>
  )
}

// Todos os valores de uma comparação têm o mesmo peso visual: nenhum lado em destaque.
function ObservationBox({ observation, metric }: { observation: EvidenceObservation; metric: string }) {
  return (
    <li className="min-w-0 rounded-selo border border-borda p-3">
      <p className="text-nota font-medium">{sourceName(observation.source_id)}</p>
      <p className="font-serif text-subtitulo font-semibold">
        <Value value={observation.value_decimal} unit={unitFor(observation.unit, metric)} />
      </p>
      <ObservationMeta observation={observation} />
    </li>
  )
}

function ComparisonFigures({ validation, observations }: { validation: EvidenceValidation; observations: EvidenceObservation[] }) {
  const c = validation.comparison
  if (!c) return null
  const unit = deltaUnit(unitFor(observations[0]?.unit ?? '', validation.metric))
  return (
    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-rotulo">
      <dt className="text-tinta-suave">Diferença entre as fontes</dt>
      <dd className="min-w-0">
        <Value value={c.delta_abs} unit={unit} />
      </dd>
      <dt className="text-tinta-suave">Limite de tolerância</dt>
      <dd className="min-w-0">
        <Value value={c.limit} unit={unit} />
      </dd>
    </dl>
  )
}

function Reason({ text }: { text: string | null }) {
  return (
    <p className="text-rotulo">
      <span className="text-tinta-suave">Motivo: </span>
      {text && text.length > 0 ? text : 'não informado'}
    </p>
  )
}

function VerifiedCell({ validation, observations }: { validation: EvidenceValidation; observations: EvidenceObservation[] }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const main =
    observations.find((o) => o.observation_id === validation.selected_observation_id) ??
    observations.find((o) => o.source_id === 'fundamentus') ??
    observations[0]
  const others = observations.filter((o) => o !== main)
  const unit = unitFor(main.unit, validation.metric)
  return (
    <div className="min-w-0">
      <p className="font-serif text-tela font-semibold">
        <Value value={main.value_decimal} unit={unit} />
      </p>
      <ObservationMeta observation={main} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="mt-1 inline-flex min-h-11 items-center gap-1 text-rotulo font-medium text-azul-caneta underline"
      >
        <ChevronDown aria-hidden="true" className={cn('size-4 transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
        {open ? 'Ocultar as outras fontes' : 'Ver as outras fontes'}
      </button>
      <div id={panelId} hidden={!open}>
        {open ? (
          <>
            <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-2">
              {others.map((o) => (
                <ObservationBox key={o.observation_id} observation={o} metric={validation.metric} />
              ))}
            </ul>
            <ComparisonFigures validation={validation} observations={observations} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function CellBody({ validation, observations }: { validation: EvidenceValidation; observations: EvidenceObservation[] }) {
  switch (validation.status) {
    case 'verified':
      return <VerifiedCell validation={validation} observations={observations} />
    case 'divergent':
      return (
        <div>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            {observations.map((o) => (
              <ObservationBox key={o.observation_id} observation={o} metric={validation.metric} />
            ))}
          </ul>
          <ComparisonFigures validation={validation} observations={observations} />
          <p className="mt-2 text-rotulo">As fontes divergem. Nenhum valor foi escolhido.</p>
        </div>
      )
    case 'single_source': {
      const o = observations.find((x) => x.observation_id === validation.selected_observation_id) ?? observations[0]
      return (
        <div>
          <p className="font-serif text-tela font-semibold">
            <Value value={o.value_decimal} unit={unitFor(o.unit, validation.metric)} />
          </p>
          <ObservationMeta observation={o} />
          <p className="mt-1 flex items-center gap-1 text-rotulo">
            <Info aria-hidden="true" className="size-4 shrink-0" />
            Não verificado entre fontes
          </p>
        </div>
      )
    }
    case 'incomparable':
      return (
        <div>
          {observations.length > 0 ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
              {observations.map((o) => (
                <ObservationBox key={o.observation_id} observation={o} metric={validation.metric} />
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-rotulo">Os valores não são comparáveis e não foram conferidos entre si.</p>
          <Reason text={validation.reason} />
        </div>
      )
    case 'missing':
      return (
        <div>
          <p className="font-semibold">Não disponível</p>
          <Reason text={validation.reason} />
        </div>
      )
    case 'not_applicable':
      return (
        <div>
          <p className="font-semibold">Não se aplica a este ativo</p>
          <Reason text={validation.reason} />
        </div>
      )
    default:
      return (
        <div>
          <p className="font-semibold">Valor inválido: não exibido</p>
          <Reason text={validation.reason} />
        </div>
      )
  }
}

function Badges({ validation }: { validation: EvidenceValidation }) {
  return (
    <div className="flex flex-wrap items-start gap-1">
      <StatusBadge status={validation.status} />
      {validation.freshness !== 'fresh' ? <FreshnessBadge status={validation.freshness} /> : null}
    </div>
  )
}

function Cell({ resolved }: { resolved: Resolved }) {
  if (!resolved.ok) return <IncompleteCell />
  return <CellBody validation={resolved.validation} observations={resolved.observations} />
}

function MetricSection({
  heading,
  validationIds,
  metric,
  resolve,
  wide,
}: {
  heading: string
  validationIds: string[]
  metric: string
  resolve: ReturnType<typeof makeResolver>
  wide: boolean
}) {
  const headingId = useId()
  const rows = validationIds.map((id) => ({ id, resolved: resolve(id, metric) }))
  const label = (r: Resolved, id: string) => (r.ok ? r.validation.asset_id : `Campo ${id.slice(0, 8)}`)
  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId} className="text-subtitulo">
        {heading}
      </h3>
      {wide ? (
        <table className="mt-2 w-full table-fixed border-collapse rounded-painel border border-borda bg-superficie text-left">
          <caption className="sr-only">{heading}: valor, estado e fonte por ativo</caption>
          <thead>
            <tr className="border-b border-borda text-rotulo text-tinta-suave">
              <th scope="col" className="w-[17%] p-3 font-medium">Ativo</th>
              <th scope="col" className="w-[24%] p-3 font-medium">Estado</th>
              <th scope="col" className="p-3 font-medium">Valor e fonte</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda">
            {rows.map(({ id, resolved }) => (
              <tr key={id} className="align-top" data-testid={resolved.ok ? `cell-${resolved.validation.asset_id}-${resolved.validation.metric}` : `cell-${id}`}>
                <th scope="row" className="p-3 font-semibold">{label(resolved, id)}</th>
                <td className="p-3">{resolved.ok ? <Badges validation={resolved.validation} /> : null}</td>
                <td className="p-3"><Cell resolved={resolved} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3">
          {rows.map(({ id, resolved }) => (
            <li
              key={id}
              className="min-w-0 rounded-painel border border-borda bg-superficie p-3"
              data-testid={resolved.ok ? `cell-${resolved.validation.asset_id}-${resolved.validation.metric}` : `cell-${id}`}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold">{label(resolved, id)}</h4>
                {resolved.ok ? <Badges validation={resolved.validation} /> : null}
              </div>
              <Cell resolved={resolved} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MetricTable({ payload, catalog }: { payload: AnswerPayload; catalog?: Catalog | null }) {
  const wide = useIsWide()
  const resolve = makeResolver(payload)
  const metricLabel = (metric: string) =>
    catalog?.metrics.find((m) => m.metric === metric)?.label ?? (isMetric(metric) ? METRIC_LABEL[metric] : 'Indicador')

  // O estado do lote vem do catálogo quando ele descreve este mesmo snapshot; senão, é o
  // pior estado registrado nas validações da resposta (sem cálculo, só uma ordem de gravidade).
  const current = catalog?.snapshot && catalog.snapshot.snapshot_id === payload.snapshot_id ? catalog.snapshot.freshness : null
  const freshness = current ?? worstFreshness(payload.evidence.validations)
  const { assets_total, assets_updated } = payload.manifest
  const collected = formatDateTime(payload.snapshot_collected_at)
  const headerId = useId()

  return (
    <div className="mt-2 min-w-0 [overflow-wrap:anywhere]">
      <header aria-labelledby={headerId} className="min-w-0 rounded-painel border border-borda bg-superficie p-3">
        <h2 id={headerId} className="text-rotulo font-semibold">Dados do lote</h2>
        <p className="text-rotulo">
          Coletado em{' '}
          {collected === 'data inválida' ? collected : <time dateTime={payload.snapshot_collected_at}>{collected}</time>}
        </p>
        <p className="text-rotulo">
          {assets_updated} de {assets_total} ativos atualizados
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <FreshnessBadge status={freshness} />
          <span className="text-nota text-tinta-suave">{current ? 'estado atual do lote' : 'estado registrado na resposta'}</span>
        </div>
        {freshness === 'stale' || freshness === 'expired' ? (
          <p className={cn('mt-2 flex items-start gap-2 font-medium', freshness === 'expired' ? 'text-carmim' : 'text-ambar-alerta')}>
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            {freshness === 'expired'
              ? 'Dados vencidos: não use como atuais. Aguarde uma nova coleta.'
              : 'Dados desatualizados: confira a data antes de usar.'}
          </p>
        ) : null}
      </header>

      {payload.sections.map((section, index) => {
        if (section.kind === 'metric_table' && section.metric) {
          return (
            <MetricSection
              key={`${section.metric}-${index}`}
              heading={metricLabel(section.metric)}
              metric={section.metric}
              validationIds={section.validation_ids}
              resolve={resolve}
              wide={wide}
            />
          )
        }
        if (section.kind === 'limitation') {
          return (
            <section key={`limitation-${index}`} aria-label="Campos sem valor apresentável" className="mt-6">
              <h3 className="text-subtitulo">Campos sem valor apresentável</h3>
              <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3">
                {section.validation_ids.map((id) => {
                  const resolved = resolve(id, null)
                  return (
                    <li key={id} className="min-w-0 rounded-painel border border-borda bg-superficie p-3" data-testid={resolved.ok ? `cell-${resolved.validation.asset_id}-${resolved.validation.metric}` : `cell-${id}`}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-semibold">
                          {resolved.ok ? `${resolved.validation.asset_id}, ${metricLabel(resolved.validation.metric)}` : 'Campo sem evidência'}
                        </h4>
                        {resolved.ok ? <Badges validation={resolved.validation} /> : null}
                      </div>
                      <Cell resolved={resolved} />
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        }
        // Seção de tabela sem indicador: não dá para saber o que mostrar.
        return (
          <section key={`bad-${index}`} className="mt-6">
            <IncompleteCell />
          </section>
        )
      })}

      {payload.warnings.length > 0 ? (
        <section aria-label="Avisos" className="mt-6">
          <h3 className="text-subtitulo">Avisos</h3>
          <ul className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2">
            {payload.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 rounded-painel border border-ambar-alerta p-3">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ambar-alerta" />
                <span>{warningText(w)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
