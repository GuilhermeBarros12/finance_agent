import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleHelp, Info, Loader2, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@/components/state'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth/hooks/sessionContext'
import { useCatalog } from '@/features/chat/hooks'
import { ConfirmDialog } from '@/features/conversations/components/ConfirmDialog'
import { PortfolioWriteError, PORTFOLIO_MAX } from '../api'
import { useAddPortfolioItem, usePortfolio, useRefreshPortfolio, useRemovePortfolioItem } from '../hooks'
import { catalogIds, resolveEntries, type PortfolioEntry } from '../resolve'

const SELECT_ID = 'carteira-acao'
const removeId = (rowId: string) => `remover-${rowId}`

type Feedback = { kind: 'ok' | 'error'; text: string } | null

const ADD_ERROR: Record<string, string> = {
  duplicate: 'Esta ação já está na carteira. A lista mostra o que está no banco.',
  unknown_asset: 'Esta ação não consta mais entre as acompanhadas pelo sistema. Atualize a página e escolha outra.',
  denied: 'Sua conta não tem permissão para alterar a carteira.',
  invalid: 'Não foi possível identificar a ação escolhida. Escolha de novo na lista.',
  other: 'Não foi possível adicionar a ação. A lista mostra o que está no banco.',
}

function Notice({ kind, children }: { kind: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const Icon = kind === 'info' ? Info : TriangleAlert
  const style =
    kind === 'error'
      ? 'border-2 border-carmim text-carmim'
      : kind === 'warn'
        ? 'border-2 border-ambar-alerta text-ambar-alerta'
        : 'border border-borda text-tinta'
  return (
    <p className={`flex min-w-0 items-start gap-2 rounded-painel p-3 ${style}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  )
}

export function PortfolioPage() {
  const state = useSession()
  const userId = state.status === 'ready' ? (state.session?.user.id ?? '') : ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const portfolio = usePortfolio(userId)
  const catalog = useCatalog(userId)
  const add = useAddPortfolioItem(userId)
  const remove = useRemovePortfolioItem(userId)
  const refresh = useRefreshPortfolio(userId)
  const [chosen, setChosen] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [removing, setRemoving] = useState<Extract<PortfolioEntry, { found: boolean }> | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const [, setFocusRequest] = useState(0)
  const selectLabelId = useId()
  const requestFocus = (id: string) => {
    pendingFocus.current = id
    setFocusRequest((n) => n + 1)
  }

  const ids = useMemo(() => (catalog.data ? catalogIds(catalog.data) : null), [catalog.data])
  const catalogAssets = ids?.kind === 'ok' ? ids.assets : null
  const entries = useMemo(
    () => (portfolio.data ? resolveEntries(portfolio.data, catalogAssets) : []),
    [portfolio.data, catalogAssets],
  )
  const inPortfolio = useMemo(() => new Set((portfolio.data ?? []).map((r) => r.asset_id)), [portfolio.data])
  // Só as ações do universo que ainda NÃO estão na carteira (por uuid, lida do banco).
  const options = useMemo(() => (catalogAssets ?? []).filter((a) => !inPortfolio.has(a.id)), [catalogAssets, inPortfolio])

  const writing = add.isPending || remove.isPending
  const count = portfolio.data?.length ?? 0
  const full = count >= PORTFOLIO_MAX
  const resolved = entries.flatMap((e) => (e.found ? [e] : []))
  const missing = entries.length - resolved.length
  const metrics = catalog.data?.metrics.map((m) => m.metric) ?? []
  const refreshing = refresh.state.kind === 'creating' || refresh.state.kind === 'sending' || refresh.state.kind === 'waiting'

  // Navega para a conversa quando a atualização termina bem.
  const done = refresh.state.kind === 'done' ? refresh.state.conversationId : null
  useEffect(() => {
    if (done) void navigate(`/conversas/${done}`)
  }, [done, navigate])

  useEffect(() => {
    if (!pendingFocus.current || writing) return
    const target = document.getElementById(pendingFocus.current) ?? document.getElementById(SELECT_ID)
    if (target) {
      target.focus()
      pendingFocus.current = null
    }
  })

  // Motivo, em texto, de o botão "Atualizar carteira" não poder ser usado agora.
  let blocked: string | null = null
  if (portfolio.isSuccess) {
    if (count === 0) blocked = 'A carteira está vazia. Adicione uma ação para poder atualizar.'
    else if (!catalog.data) blocked = 'O catálogo de ações não está disponível, então não dá para saber o símbolo de cada ação.'
    else if (ids?.kind === 'no_ids') blocked = 'O catálogo veio sem o identificador das ações. Não dá para atualizar a carteira.'
    else if (resolved.length === 0) blocked = 'Nenhuma ação da carteira consta no catálogo. Remova-as ou adicione outras.'
    else if (resolved.length > PORTFOLIO_MAX) blocked = `A carteira tem mais de ${PORTFOLIO_MAX} ações. Remova algumas: cada atualização aceita até ${PORTFOLIO_MAX}.`
    else if (metrics.length === 0) blocked = 'O catálogo veio sem os indicadores. Não dá para atualizar a carteira.'
  }

  async function handleAdd() {
    setFeedback(null)
    const asset = options.find((a) => a.id === chosen)
    if (!asset) {
      setFeedback({ kind: 'error', text: 'Escolha uma ação da lista antes de adicionar.' })
      requestFocus(SELECT_ID)
      return
    }
    try {
      await add.mutateAsync(asset.id)
      setChosen('')
      setFeedback({ kind: 'ok', text: `${asset.symbol} adicionada à carteira.` })
    } catch (error) {
      const kind = error instanceof PortfolioWriteError ? error.kind : 'other'
      setChosen('')
      setFeedback({ kind: 'error', text: ADD_ERROR[kind] })
    }
    requestFocus(SELECT_ID)
  }

  async function handleRemove(entry: PortfolioEntry) {
    setFeedback(null)
    const label = entry.found ? entry.symbol : 'A ação'
    const index = entries.findIndex((e) => e.rowId === entry.rowId)
    const neighbour = entries[index + 1] ?? entries[index - 1]
    try {
      await remove.mutateAsync(entry.rowId)
      requestFocus(neighbour ? removeId(neighbour.rowId) : SELECT_ID)
      setFeedback({ kind: 'ok', text: `${label} removida da carteira.` })
    } catch {
      requestFocus(removeId(entry.rowId))
      setFeedback({ kind: 'error', text: 'Não foi possível remover a ação. A lista mostra o que está no banco.' })
    } finally {
      setRemoving(null)
    }
  }

  function handleRefresh() {
    if (blocked || refreshing) return
    void refresh.run(
      resolved.map((e) => e.symbol),
      metrics,
    )
  }

  const selectDisabled = writing || full || options.length === 0
  const canAddNow = catalogAssets !== null && portfolio.isSuccess

  return (
    <section className="min-w-0">
      <h1 className="text-tela">Carteira</h1>
      <p className="mt-2 flex max-w-prose items-start gap-2 text-tinta-suave">
        <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>
          Só as ações acompanhadas pelo sistema podem ser adicionadas. A carteira guarda apenas o símbolo de cada ação:
          nunca quantidade, preço nem valor. Ela não é enviada a nenhum serviço de IA.
        </span>
      </p>

      <div aria-live="polite" className="mt-4 min-w-0">
        {feedback ? (
          <p
            role={feedback.kind === 'error' ? 'alert' : 'status'}
            className={
              feedback.kind === 'error'
                ? 'flex items-start gap-2 rounded-painel border-2 border-carmim p-3 text-carmim'
                : 'flex items-start gap-2 rounded-painel border border-verde-conferido p-3 text-verde-conferido'
            }
          >
            {feedback.kind === 'error' ? (
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            ) : (
              <Check aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">{feedback.text}</span>
          </p>
        ) : null}
      </div>

      {catalog.isError && !catalog.isFetching ? (
        <div className="mt-4">
          <ErrorState
            title="Não foi possível carregar as ações do sistema"
            message="Sem o catálogo não dá para adicionar ações, mostrar os símbolos nem atualizar a carteira. Você ainda pode remover itens."
            onRetry={() => void catalog.refetch()}
          />
        </div>
      ) : null}
      {ids?.kind === 'no_ids' ? (
        <div className="mt-4">
          <ErrorState
            title="Catálogo sem identificador dos ativos"
            message="O servidor respondeu sem o identificador de cada ação. Nada é adivinhado: adicionar e atualizar ficam indisponíveis até o servidor ser atualizado."
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['catalog', userId] })}
          />
        </div>
      ) : null}

      <div className="mt-6 min-w-0">
        <h2 className="text-subtitulo">Adicionar uma ação</h2>
        <form
          className="mt-2 flex max-w-prose flex-col gap-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (!selectDisabled && canAddNow) void handleAdd()
          }}
        >
          <label id={selectLabelId} htmlFor={SELECT_ID} className="text-rotulo font-medium">
            Ação do sistema
          </label>
          <select
            id={SELECT_ID}
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            aria-disabled={selectDisabled || undefined}
            aria-describedby="carteira-add-ajuda"
            className="min-h-11 w-full min-w-0 rounded-selo border border-borda bg-superficie px-3 text-texto"
          >
            <option value="">{options.length === 0 ? 'Nenhuma ação disponível' : 'Escolha uma ação'}</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol} — {a.name}
              </option>
            ))}
          </select>
          <p id="carteira-add-ajuda" className="text-nota text-tinta-suave">
            {!canAddNow
              ? 'A lista de ações aparece quando o catálogo e a carteira forem carregados.'
              : full
                ? `A carteira já tem o máximo de ${PORTFOLIO_MAX} ações. Remova uma para adicionar outra.`
                : options.length === 0
                  ? 'Todas as ações acompanhadas pelo sistema já estão na carteira.'
                  : `Mostra só as ações que ainda não estão na carteira. Limite de ${PORTFOLIO_MAX} ações.`}
          </p>
          <div>
            <Button type="submit" aria-disabled={selectDisabled || !canAddNow || undefined}>
              <Plus aria-hidden="true" className="size-5" />
              {add.isPending ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </div>
        </form>
      </div>

      <div className="mt-8 min-w-0">
        <h2 className="text-subtitulo">Ações na carteira</h2>
        <div className="mt-2">
          {portfolio.isPending ? (
            <LoadingState label="Carregando a carteira..." />
          ) : portfolio.isError ? (
            <ErrorState
              title="Não foi possível carregar a carteira"
              message="A leitura no banco falhou. Nenhuma ação é mostrada até a leitura dar certo."
              onRetry={() => void portfolio.refetch()}
            />
          ) : entries.length === 0 ? (
            <EmptyState
              title="Sua carteira está vazia"
              description="Escolha uma ação na lista acima e use Adicionar. Com a primeira ação na carteira você poderá atualizar os indicadores de todas de uma vez."
              action={
                <Button
                  variant="outline"
                  onClick={() => document.getElementById(SELECT_ID)?.focus()}
                >
                  <Plus aria-hidden="true" className="size-5" />
                  Escolher a primeira ação
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-borda rounded-painel border border-borda bg-superficie">
              {entries.map((entry) => (
                <li key={entry.rowId} className="flex flex-col gap-3 p-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                  <div className="min-w-0">
                    {entry.found ? (
                      <>
                        <p className="text-subtitulo font-semibold [overflow-wrap:anywhere]">{entry.symbol}</p>
                        <p className="text-nota text-tinta-suave [overflow-wrap:anywhere]">{entry.name}</p>
                      </>
                    ) : (
                      <p className="flex items-start gap-2 text-ambar-alerta">
                        <CircleHelp aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {catalog.data && ids?.kind === 'ok'
                            ? 'Ativo não encontrado no catálogo'
                            : 'Símbolo indisponível: catálogo não carregado'}
                        </span>
                      </p>
                    )}
                  </div>
                  <Button
                    id={removeId(entry.rowId)}
                    variant="outline"
                    aria-disabled={writing || undefined}
                    onClick={() => !writing && setRemoving(entry)}
                    aria-label={entry.found ? `Remover ${entry.symbol} da carteira` : 'Remover ativo não encontrado da carteira'}
                    className="shrink-0 border-carmim text-carmim"
                  >
                    <Trash2 aria-hidden="true" className="size-5" />
                    Remover
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-8 min-w-0 max-w-prose">
        <h2 className="text-subtitulo">Atualizar indicadores</h2>
        <p className="mt-2 text-tinta-suave">
          Abre uma conversa nova com os cinco indicadores de todas as ações da carteira, sem fazer pergunta por texto.
        </p>
        <div className="mt-3">
          <Button
            aria-disabled={blocked !== null || refreshing || undefined}
            aria-describedby="carteira-atualizar-ajuda"
            onClick={handleRefresh}
          >
            <RefreshCw aria-hidden="true" className="size-5" />
            {refresh.state.kind === 'creating'
              ? 'Criando a conversa...'
              : refresh.state.kind === 'sending'
                ? 'Enviando...'
                : refresh.state.kind === 'waiting'
                  ? 'Aguardando o servidor...'
                  : 'Atualizar carteira'}
          </Button>
        </div>
        <div id="carteira-atualizar-ajuda" className="mt-2 min-w-0">
          {blocked ? <Notice kind="info">{blocked}</Notice> : null}
          {!blocked && missing > 0 ? (
            <Notice kind="warn">
              {missing === 1 ? '1 ação' : `${missing} ações`} da carteira não consta{missing === 1 ? '' : 'm'} no catálogo e ficará
              {missing === 1 ? '' : 'ão'} de fora da atualização.
            </Notice>
          ) : null}
        </div>
        <div aria-live="polite" className="mt-3 min-w-0">
          {refreshing ? (
            <p role="status" className="flex items-start gap-2 text-tinta-suave">
              <Loader2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none" />
              <span>
                {refresh.state.kind === 'creating'
                  ? 'Criando a conversa...'
                  : refresh.state.kind === 'waiting'
                    ? 'O servidor ainda está processando. Aguardando...'
                    : 'Enviando o pedido...'}
              </span>
            </p>
          ) : null}
          {refresh.state.kind === 'error' ? (
            <div role="alert" className="rounded-painel border-2 border-carmim p-3 text-carmim">
              <p className="flex items-start gap-2 font-semibold">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <span>{refresh.state.view.title}</span>
              </p>
              <p className="mt-1 text-tinta">
                {refresh.state.view.selector
                  ? 'Alguma ação da carteira não foi reconhecida pelo servidor. Remova-a da carteira e tente de novo.'
                  : refresh.state.view.message}
              </p>
              {refresh.state.conversationId ? (
                <p className="mt-1 text-tinta">
                  A conversa já foi criada e fica na lista de conversas.{' '}
                  <Link to={`/conversas/${refresh.state.conversationId}`} className="inline-flex min-h-11 items-center text-azul-caneta underline">
                    Abrir a conversa
                  </Link>
                </p>
              ) : null}
              {refresh.state.view.retry ? (
                <Button variant="outline" className="mt-2" onClick={handleRefresh}>
                  Tentar de novo
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {removing ? (
        <ConfirmDialog
          title="Remover da carteira?"
          description={
            removing.found
              ? `${removing.symbol} sai da carteira. A ação continua disponível para adicionar de novo.`
              : 'Este item sai da carteira.'
          }
          confirmLabel="Remover da carteira"
          pendingLabel="Removendo..."
          pending={remove.isPending}
          onConfirm={() => void handleRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </section>
  )
}
