import { ArrowLeft, Bot, Check, History, ListChecks, Loader2, MessageSquareOff, Send, TriangleAlert, User } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@/components/state'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth/hooks/sessionContext'
import { MESSAGE_MAX, type AgentRequest, type ChatMessage, type Selection } from '../api'
import { readPayload } from '../contracts'
import { flattenMessages, useAgentSend, useCatalog, useConversation, useMessages } from '../hooks'
import { MetricTable } from './MetricTable'
import { SelectionDialog } from './SelectionDialog'

const messageDomId = (id: string) => `msg-${id}`

function MessageItem({ message, catalog }: { message: ChatMessage; catalog: ReturnType<typeof useCatalog>['data'] }) {
  const isUser = message.role === 'user'
  const payload = useMemo(
    () => (isUser || message.payload === null ? null : readPayload(message.payload, message.content_version)),
    [isUser, message.payload, message.content_version],
  )
  const unreadable = !isUser && message.payload !== null && payload === null
  return (
    <li id={messageDomId(message.id)} tabIndex={-1} className="min-w-0 rounded-painel border border-borda bg-superficie p-3 md:p-4">
      <p className="flex items-center gap-2 text-rotulo font-semibold">
        {isUser ? <User aria-hidden="true" className="size-5" /> : <Bot aria-hidden="true" className="size-5" />}
        {isUser ? 'Você' : 'Agente'}
      </p>
      {isUser ? (
        <p className="mt-1 max-w-prose whitespace-pre-wrap [overflow-wrap:anywhere]">{message.content}</p>
      ) : payload ? (
        <MetricTable payload={payload} catalog={catalog} />
      ) : (
        <>
          <p className="mt-1 max-w-prose whitespace-pre-wrap [overflow-wrap:anywhere]">{message.content}</p>
          {unreadable ? (
            <p className="mt-2 flex items-start gap-2 text-carmim">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              Os dados desta resposta estão em um formato não reconhecido e não foram exibidos.
            </p>
          ) : null}
        </>
      )}
    </li>
  )
}

function codePoints(text: string) {
  return [...text].length
}

// `key={id}`: trocar de conversa remonta a tela, sem herdar rascunho, seleção ou request_id.
export function ChatPage() {
  const { id = '' } = useParams()
  return <ChatConversation key={id} id={id} />
}

function ChatConversation({ id }: { id: string }) {
  const session = useSession()
  const userId = session.status === 'ready' ? (session.session?.user.id ?? '') : ''
  const conversation = useConversation(userId, id)
  const found = conversation.isSuccess && conversation.data !== null
  const messages = useMessages(userId, id, found)
  const catalog = useCatalog(userId)

  const [draft, setDraft] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [selector, setSelector] = useState<{ auto: boolean; code: string | null } | null>(null)
  const { state, send } = useAgentSend(userId, id, () => setDraft(''))
  const textareaId = useId()
  const counterId = useId()
  const errorId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const list = useMemo(() => flattenMessages(messages.data?.pages), [messages.data])
  const trimmed = draft.trim()
  const count = codePoints(draft)
  const overLimit = codePoints(trimmed) > MESSAGE_MAX
  const sending = state.kind === 'sending' || state.kind === 'waiting'

  // needs_selection abre o seletor sozinho; o fim do envio (ok ou erro) o fecha.
  async function sendAndSync(request: AgentRequest) {
    const result = await send(request)
    if (result?.kind === 'needs_selection') setSelector({ auto: true, code: result.code })
    else if (result?.kind === 'done' || result?.kind === 'error') setSelector(null)
  }

  // Foco ao carregar mensagens anteriores: vai para a mensagem logo acima da que estava no topo.
  const topBefore = useRef<string | null>(null)
  useEffect(() => {
    const before = topBefore.current
    if (!before || list.length === 0 || list[0].id === before) return
    const index = list.findIndex((m) => m.id === before)
    topBefore.current = null
    if (index > 0) document.getElementById(messageDomId(list[index - 1].id))?.focus()
  }, [list])

  // Depois de uma resposta nova, leva a vista até ela.
  const lastId = list.length > 0 ? list[list.length - 1].id : null
  const seenLast = useRef<string | null>(null)
  useEffect(() => {
    if (seenLast.current !== null && lastId !== seenLast.current && state.kind === 'done' && lastId) {
      document.getElementById(messageDomId(lastId))?.scrollIntoView?.({ block: 'start' })
    }
    seenLast.current = lastId
  }, [lastId, state.kind])

  function submitText(event: React.FormEvent) {
    event.preventDefault()
    if (sending) return
    if (trimmed.length === 0) {
      setFormError('Digite uma pergunta ou escolha ações e indicadores no seletor.')
      return
    }
    if (overLimit) {
      setFormError(`A pergunta pode ter no máximo ${MESSAGE_MAX.toLocaleString('pt-BR')} caracteres.`)
      return
    }
    setFormError(null)
    void sendAndSync({ message: trimmed, selection: null })
  }

  function submitSelection(selection: Selection) {
    if (overLimit) {
      setSelector(null) // o aviso de limite fica visível na caixa de pergunta
      return
    }
    setFormError(null)
    void sendAndSync({ message: trimmed.length > 0 ? trimmed : null, selection })
  }

  if (conversation.isPending) return <LoadingState label="Carregando conversa..." />
  if (conversation.isError) {
    return (
      <ErrorState
        title="Não foi possível carregar a conversa"
        message="A leitura no banco falhou. Nada é mostrado até a leitura dar certo."
        onRetry={() => void conversation.refetch()}
      />
    )
  }
  if (conversation.data === null) {
    return (
      <section>
        <div role="alert" className="rounded-painel border-2 border-borda p-6">
          <h1 className="flex items-center gap-2 text-tela">
            <MessageSquareOff aria-hidden="true" className="size-6 shrink-0" />
            Conversa não encontrada
          </h1>
          <p className="mt-2 max-w-prose">Esta conversa não existe ou não é sua.</p>
          <Link to="/" className="mt-4 inline-flex min-h-11 items-center gap-2 text-azul-caneta underline">
            <ArrowLeft aria-hidden="true" className="size-5" />
            Voltar para as conversas
          </Link>
        </div>
      </section>
    )
  }

  const status =
    state.kind === 'sending'
      ? 'Enviando pergunta...'
      : state.kind === 'waiting'
        ? 'Ainda processando. Nova tentativa em instantes...'
        : state.kind === 'done'
          ? 'Resposta recebida.'
          : ''

  return (
    <section className="min-w-0">
      <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-azul-caneta underline">
        <ArrowLeft aria-hidden="true" className="size-5" />
        Conversas
      </Link>
      <h1 className="text-tela [overflow-wrap:anywhere]">{conversation.data.title}</h1>

      <div className="mt-4">
        {messages.isPending ? (
          <LoadingState label="Carregando mensagens..." />
        ) : messages.isError ? (
          <ErrorState
            title="Não foi possível carregar as mensagens"
            message="A leitura no banco falhou. Nenhuma mensagem é mostrada até a leitura dar certo."
            onRetry={() => void messages.refetch()}
          />
        ) : (
          <>
            {messages.hasNextPage ? (
              <Button
                variant="outline"
                className="mb-3"
                aria-disabled={messages.isFetchingNextPage || undefined}
                onClick={() => {
                  if (messages.isFetchingNextPage) return
                  topBefore.current = list[0]?.id ?? null
                  void messages.fetchNextPage()
                }}
              >
                <History aria-hidden="true" className="size-5" />
                {messages.isFetchingNextPage ? 'Carregando...' : 'Carregar mensagens anteriores'}
              </Button>
            ) : null}
            {messages.isFetchNextPageError ? (
              <p role="alert" className="mb-3 flex items-center gap-2 text-carmim">
                <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
                Não foi possível carregar as mensagens anteriores.
              </p>
            ) : null}
            {list.length === 0 ? (
              <EmptyState
                title="Nenhuma mensagem ainda"
                description="Pergunte sobre um indicador de uma ação, ou escolha ações e indicadores no seletor."
              />
            ) : (
              <ol aria-label="Mensagens" className="grid grid-cols-[minmax(0,1fr)] gap-3">
                {list.map((m) => (
                  <MessageItem key={m.id} message={m} catalog={catalog.data} />
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div aria-live="polite" role="status" className="mt-4 min-h-6">
        {status ? (
          <p className="flex items-center gap-2 text-rotulo">
            {state.kind === 'done' ? (
              <Check aria-hidden="true" className="size-5 shrink-0 text-verde-conferido" />
            ) : (
              <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin motion-reduce:animate-none" />
            )}
            {status}
          </p>
        ) : null}
      </div>

      {state.kind === 'error' ? (
        <div role="alert" className="mt-2 rounded-painel border-2 border-carmim p-4">
          <p className="flex items-center gap-2 font-semibold text-carmim">
            <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
            {state.view.title}
          </p>
          <p className="mt-1 max-w-prose">{state.view.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.view.retry ? (
              <Button variant="outline" onClick={() => void sendAndSync(state.request)}>
                Tentar de novo
              </Button>
            ) : null}
            {state.view.selector ? (
              <Button variant="outline" onClick={() => setSelector({ auto: false, code: null })}>
                <ListChecks aria-hidden="true" className="size-5" />
                Abrir o seletor
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <form onSubmit={submitText} noValidate className="mt-4 flex flex-col gap-2">
        <label htmlFor={textareaId} className="text-rotulo font-medium">
          Sua pergunta
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-describedby={`${counterId}${formError || overLimit ? ` ${errorId}` : ''}`}
          aria-invalid={overLimit || formError ? true : undefined}
          className="min-h-24 w-full rounded-selo border border-borda bg-superficie p-3"
        />
        <p id={counterId} className={overLimit ? 'text-nota font-semibold text-carmim' : 'text-nota text-tinta-suave'}>
          {count} de {MESSAGE_MAX.toLocaleString('pt-BR')} caracteres
          {overLimit ? ': acima do limite' : ''}
        </p>
        <div aria-live="assertive">
          {formError || overLimit ? (
            <p id={errorId} role="alert" className="flex items-center gap-2 text-carmim">
              <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
              {formError ?? `A pergunta pode ter no máximo ${MESSAGE_MAX.toLocaleString('pt-BR')} caracteres.`}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" aria-disabled={sending || overLimit || undefined}>
            <Send aria-hidden="true" className="size-5" />
            {sending ? 'Enviando...' : 'Enviar pergunta'}
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-disabled={sending || undefined}
            onClick={() => !sending && setSelector({ auto: false, code: null })}
          >
            <ListChecks aria-hidden="true" className="size-5" />
            Escolher ações e indicadores
          </Button>
        </div>
      </form>

      {selector ? (
        <SelectionDialog
          reasonCode={selector.code}
          autoOpened={selector.auto}
          catalog={{ isPending: catalog.isPending, isError: catalog.isError, data: catalog.data, refetch: () => void catalog.refetch() }}
          hasMessage={trimmed.length > 0}
          pending={sending}
          onConfirm={submitSelection}
          onCancel={() => setSelector(null)}
        />
      ) : null}
    </section>
  )
}
