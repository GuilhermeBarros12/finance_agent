import { ExternalLink, Info, Search, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { EmptyState, ErrorState, LoadingState } from '@/components/state'
import { Button } from '@/components/ui/button'
import type { Catalog } from '../contracts'
import { safeSourceUrl } from '../safeLink'
import type { Selection } from '../api'
import { reasonText } from '../texts'

export const MAX_ASSETS = 20
export const MAX_METRICS = 5

interface Props {
  // Código de needs_selection; null quando o usuário abriu o seletor por conta própria.
  reasonCode: string | null
  autoOpened: boolean
  catalog: { isPending: boolean; isError: boolean; data: Catalog | undefined; refetch: () => void }
  hasMessage: boolean
  pending: boolean
  onConfirm: (selection: Selection) => void
  onCancel: () => void
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

// Diálogo próprio (o jsdom não tem showModal): foco preso, Esc fecha, foco volta a quem abriu.
export function SelectionDialog({ reasonCode, autoOpened, catalog, hasMessage, pending, onConfirm, onCancel }: Props) {
  const titleId = useId()
  const descId = useId()
  const errorId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [assets, setAssets] = useState<string[]>([])
  const [metrics, setMetrics] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    titleRef.current?.focus()
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!pending) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || !catalog.data) return
    if (assets.length < 1 || assets.length > MAX_ASSETS) {
      setError(assets.length < 1 ? 'Escolha pelo menos uma ação.' : `Escolha no máximo ${MAX_ASSETS} ações.`)
      return
    }
    if (metrics.length < 1 || metrics.length > MAX_METRICS) {
      setError(metrics.length < 1 ? 'Escolha pelo menos um indicador.' : `Escolha no máximo ${MAX_METRICS} indicadores.`)
      return
    }
    setError(null)
    // Na ordem do catálogo (estável): o mesmo conjunto gera sempre o mesmo pedido.
    onConfirm({
      asset_ids: catalog.data.assets.map((a) => a.asset_id).filter((id) => assets.includes(id)),
      metrics: catalog.data.metrics.map((m) => m.metric as string).filter((m) => metrics.includes(m)),
    })
  }

  const data = catalog.data
  const needle = query.trim().toLowerCase()
  const shownAssets = data ? data.assets.filter((a) => !needle || a.asset_id.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)) : []

  return (
    <div className="fixed inset-0 z-50 flex overflow-y-auto bg-sobreposicao p-4" onKeyDown={onKeyDown}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="m-auto w-full max-w-lg rounded-painel border-2 border-azul-caneta bg-superficie p-4 md:p-6"
      >
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="text-subtitulo">
          Escolher ações e indicadores
        </h2>
        <div id={descId}>
          {autoOpened ? (
            <p role="status" className="mt-2 flex items-start gap-2 rounded-painel border border-ambar-alerta p-3">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ambar-alerta" />
              <span>
                {reasonText(reasonCode)} Escolha abaixo o que consultar.
                {hasMessage ? ' A sua pergunta será enviada junto com a escolha.' : ''}
              </span>
            </p>
          ) : (
            <p className="mt-2 max-w-prose text-tinta-suave">Marque de 1 a {MAX_ASSETS} ações e de 1 a {MAX_METRICS} indicadores.</p>
          )}
        </div>

        {catalog.isPending ? (
          <LoadingState label="Carregando ações e indicadores..." />
        ) : catalog.isError || !data ? (
          <div className="mt-4">
            <ErrorState
              title="Não foi possível carregar o catálogo"
              message="A lista de ações e indicadores não chegou. Nada foi escolhido por você."
              onRetry={() => catalog.refetch()}
            />
          </div>
        ) : data.assets.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Nenhuma ação cadastrada" description="O catálogo não tem ações. Tente de novo depois da primeira coleta." />
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
            {data.snapshot === null ? (
              <p className="flex items-start gap-2 rounded-painel border border-borda p-3">
                <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <span>Os dados ainda não foram coletados. A consulta vai falhar até o primeiro lote ser publicado.</span>
              </p>
            ) : null}

            <fieldset className="min-w-0">
              <legend className="text-rotulo font-semibold">Ações ({assets.length} de até {MAX_ASSETS})</legend>
              <label htmlFor="busca-acao" className="mt-2 block text-rotulo">Buscar ação</label>
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" />
                <input
                  id="busca-acao"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-h-11 w-full rounded-selo border border-borda bg-superficie pl-10 pr-3"
                />
              </div>
              {shownAssets.length === 0 ? (
                <p className="mt-2 text-tinta-suave">Nenhuma ação corresponde à busca.</p>
              ) : (
                <ul className="mt-2 max-h-60 divide-y divide-borda overflow-y-auto rounded-painel border border-borda">
                  {shownAssets.map((a) => {
                    const href = a.reference_url ? safeSourceUrl(a.reference_url) : null
                    return (
                      <li key={a.asset_id} className="flex items-center">
                        <label className="flex min-h-11 flex-1 items-center gap-3 px-3 py-1">
                          <input
                            type="checkbox"
                            className="size-5 shrink-0 accent-azul-caneta"
                            checked={assets.includes(a.asset_id)}
                            onChange={() => toggle(assets, setAssets, a.asset_id)}
                          />
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            <span className="font-semibold">{a.asset_id}</span>
                            <span className="text-tinta-suave"> {a.name}</span>
                          </span>
                        </label>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Consultar ${a.asset_id} no StatusInvest (abre em nova aba)`}
                            className="flex size-11 shrink-0 items-center justify-center text-azul-caneta"
                          >
                            <ExternalLink aria-hidden="true" className="size-5" />
                          </a>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </fieldset>

            <fieldset className="min-w-0">
              <legend className="text-rotulo font-semibold">Indicadores ({metrics.length} de até {MAX_METRICS})</legend>
              <ul className="mt-2 divide-y divide-borda rounded-painel border border-borda">
                {data.metrics.map((m) => (
                  <li key={m.metric}>
                    <label className="flex min-h-11 items-center gap-3 px-3 py-1">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-azul-caneta"
                        checked={metrics.includes(m.metric)}
                        onChange={() => toggle(metrics, setMetrics, m.metric)}
                      />
                      <span>{m.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div aria-live="assertive">
              {error ? (
                <p id={errorId} role="alert" className="flex items-center gap-2 text-carmim">
                  <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => !pending && onCancel()} aria-disabled={pending || undefined}>
                <X aria-hidden="true" className="size-5" />
                Cancelar
              </Button>
              <Button type="submit" aria-disabled={pending || undefined}>
                <Search aria-hidden="true" className="size-5" />
                {pending ? 'Consultando...' : 'Consultar'}
              </Button>
            </div>
          </form>
        )}
        {!data || data.assets.length === 0 ? (
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" onClick={onCancel}>
              <X aria-hidden="true" className="size-5" />
              Fechar
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
