import { Check, MessageSquare, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@/components/state'
import { Button } from '@/components/ui/button'
import { authorizationKey } from '@/features/auth/hooks/useAuthorization'
import { useSession } from '@/features/auth/hooks/sessionContext'
import { checkTitle, type Conversation } from '../api'
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
} from '../hooks'
import { ConfirmDialog } from './ConfirmDialog'

const NEW_ID = 'nova-conversa'
const renameId = (id: string) => `renomear-${id}`
const deleteId = (id: string) => `excluir-${id}`
const titleLinkId = (id: string) => `titulo-${id}`

type Feedback = { kind: 'ok' | 'error'; text: string } | null

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function formatDate(iso: string) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date)
}

function RenameForm({
  conversation,
  pending,
  onSubmit,
  onCancel,
}: {
  conversation: Conversation
  pending: boolean
  onSubmit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(conversation.title)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const check = checkTitle(value)
    if (!check.ok) {
      setError(check.message)
      return
    }
    setError(null)
    onSubmit(check.title)
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <label htmlFor={inputId} className="text-rotulo font-medium">
        Novo título
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="min-h-11 w-full rounded-selo border border-borda bg-superficie px-3 text-texto"
      />
      <div aria-live="assertive">
        {error ? (
          <p id={errorId} role="alert" className="flex items-center gap-2 text-carmim">
            <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          <Check aria-hidden="true" className="size-5" />
          {pending ? 'Salvando...' : 'Salvar título'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          <X aria-hidden="true" className="size-5" />
          Cancelar
        </Button>
      </div>
    </form>
  )
}

export function ConversationsPage() {
  const state = useSession()
  const userId = state.status === 'ready' ? (state.session?.user.id ?? '') : ''
  const query = useConversations(userId)
  const create = useCreateConversation(userId)
  const rename = useRenameConversation(userId)
  const remove = useDeleteConversation(userId)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Conversation | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  // Id do elemento que deve receber o foco quando existir e estiver habilitado.
  const pendingFocus = useRef<string | null>(null)
  const [, setFocusRequest] = useState(0)
  const requestFocus = (id: string) => {
    pendingFocus.current = id
    setFocusRequest((n) => n + 1) // garante um render depois do pedido
  }
  const queryClient = useQueryClient()

  const busy = create.isPending || rename.isPending || remove.isPending

  // Lista vazia pode ser usuário revogado (a RLS filtra tudo): confere a autorização de novo.
  const emptyAt = query.isSuccess && query.data.length === 0 ? query.dataUpdatedAt : null
  useEffect(() => {
    if (emptyAt !== null) void queryClient.invalidateQueries({ queryKey: authorizationKey(userId) })
  }, [emptyAt, queryClient, userId])

  useEffect(() => {
    if (!pendingFocus.current || busy) return
    const target = document.getElementById(pendingFocus.current) ?? document.getElementById(NEW_ID)
    if (target && !(target as HTMLButtonElement).disabled) {
      target.focus()
      pendingFocus.current = null
    }
  })

  async function handleCreate() {
    setFeedback(null)
    try {
      await create.mutateAsync()
      setFeedback({ kind: 'ok', text: 'Conversa criada.' })
    } catch {
      setFeedback({ kind: 'error', text: 'Não foi possível criar a conversa. A lista mostra o que está no banco.' })
    }
  }

  async function handleRename(conversation: Conversation, title: string) {
    setFeedback(null)
    try {
      await rename.mutateAsync({ id: conversation.id, title })
      setRenamingId(null)
      requestFocus(renameId(conversation.id))
      setFeedback({ kind: 'ok', text: 'Título alterado.' })
    } catch {
      setRenamingId(null)
      requestFocus(renameId(conversation.id))
      setFeedback({ kind: 'error', text: 'Não foi possível renomear a conversa. A lista mostra o que está no banco.' })
    }
  }

  async function handleDelete(conversation: Conversation) {
    setFeedback(null)
    try {
      const list = query.data ?? []
      const index = list.findIndex((c) => c.id === conversation.id)
      const neighbour = list[index + 1] ?? list[index - 1]
      await remove.mutateAsync(conversation.id)
      requestFocus(neighbour ? titleLinkId(neighbour.id) : NEW_ID)
      setFeedback({ kind: 'ok', text: 'Conversa excluída.' })
    } catch {
      requestFocus(deleteId(conversation.id))
      setFeedback({ kind: 'error', text: 'Não foi possível excluir a conversa. A lista mostra o que está no banco.' })
    } finally {
      setDeleting(null)
    }
  }

  const newButton = (
    <Button id={NEW_ID} onClick={() => void handleCreate()} disabled={busy}>
      <Plus aria-hidden="true" className="size-5" />
      {create.isPending ? 'Criando...' : 'Nova conversa'}
    </Button>
  )

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-tela">Conversas</h1>
        {newButton}
      </div>

      <div aria-live="polite" className="mt-4">
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
            <span>{feedback.text}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        {query.isPending ? (
          <LoadingState label="Carregando conversas..." />
        ) : query.isError ? (
          <ErrorState
            title="Não foi possível carregar as conversas"
            message="A leitura no banco falhou. Nenhuma conversa é mostrada até a leitura dar certo."
            onRetry={() => void query.refetch()}
          />
        ) : query.data.length === 0 ? (
          <EmptyState
            title="Nenhuma conversa ainda"
            description="Crie uma conversa para perguntar sobre os indicadores de uma ação."
          />
        ) : (
          <ul className="divide-y divide-borda rounded-painel border border-borda bg-superficie">
            {query.data.map((conversation) => (
              <li key={conversation.id} className="p-4">
                {renamingId === conversation.id ? (
                  <RenameForm
                    conversation={conversation}
                    pending={rename.isPending}
                    onSubmit={(title) => void handleRename(conversation, title)}
                    onCancel={() => {
                      setRenamingId(null)
                      requestFocus(renameId(conversation.id))
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <Link
                        id={titleLinkId(conversation.id)}
                        to={`/conversas/${conversation.id}`}
                        className="flex min-h-11 items-center gap-2 break-words text-subtitulo font-semibold text-azul-caneta underline"
                      >
                        <MessageSquare aria-hidden="true" className="size-5 shrink-0" />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{conversation.title}</span>
                      </Link>
                      <p className="text-nota text-tinta-suave">
                        Atualizada em <time dateTime={conversation.updated_at}>{formatDate(conversation.updated_at)}</time>
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        id={renameId(conversation.id)}
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setFeedback(null)
                          setRenamingId(conversation.id)
                        }}
                        aria-label={`Renomear ${conversation.title}`}
                      >
                        <Pencil aria-hidden="true" className="size-5" />
                        Renomear
                      </Button>
                      <Button
                        id={deleteId(conversation.id)}
                        variant="outline"
                        disabled={busy}
                        onClick={() => setDeleting(conversation)}
                        aria-label={`Excluir ${conversation.title}`}
                        className="border-carmim text-carmim"
                      >
                        <Trash2 aria-hidden="true" className="size-5" />
                        Excluir
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleting ? (
        <ConfirmDialog
          title="Excluir esta conversa?"
          description={`"${deleting.title}" e todas as mensagens dela serão apagadas. Não dá para desfazer.`}
          confirmLabel="Excluir conversa"
          pending={remove.isPending}
          onConfirm={() => void handleDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </section>
  )
}
