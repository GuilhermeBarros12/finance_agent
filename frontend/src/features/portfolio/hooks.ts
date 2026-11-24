import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authorizationKey } from '@/features/auth/hooks/useAuthorization'
import { newRequestId, postAgentWithRetry } from '@/features/chat/api'
import { errorView, type AgentErrorView } from '@/features/chat/texts'
import { createConversationWithId } from '@/features/conversations/api'
import { conversationsKey } from '@/features/conversations/hooks'
import { supabase } from '@/lib/supabase'
import { addPortfolioItem, listPortfolio, removePortfolioItem } from './api'
import { titleForRefresh } from './resolve'

export const portfolioKey = (userId: string) => ['portfolio', userId] as const

export function usePortfolio(userId: string) {
  return useQuery({ queryKey: portfolioKey(userId), queryFn: listPortfolio, staleTime: 0 })
}

// Sem atualização otimista (D17): depois de cada escrita, com sucesso ou erro, a lista é
// relida do banco. A mutação só termina quando a releitura termina.
function useWrite<V>(userId: string, write: (v: V) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onSettled: () => queryClient.invalidateQueries({ queryKey: portfolioKey(userId) }),
  })
}

export function useAddPortfolioItem(userId: string) {
  return useWrite<string>(userId, (assetUuid) => addPortfolioItem(userId, assetUuid))
}

export function useRemovePortfolioItem(userId: string) {
  return useWrite<string>(userId, removePortfolioItem)
}

export type RefreshState =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'sending' }
  | { kind: 'waiting' }
  | { kind: 'error'; view: AgentErrorView; conversationId: string | null }
  | { kind: 'done'; conversationId: string }

const CREATE_FAILED: AgentErrorView = {
  title: 'Não foi possível criar a conversa',
  message: 'A conversa que receberia a atualização não foi criada. Nada foi enviado. Tente de novo.',
  retry: true,
}

// "Atualizar carteira": cria uma conversa e envia POST /agent com `selection` (símbolos de
// toda a carteira e os indicadores do catálogo) e SEM `message`: caminho determinístico, sem
// LLM. O corpo nunca leva `message`.
// Reenvio da mesma operação (mesmos símbolos e indicadores) depois de falha sem resposta
// conclusiva reutiliza a conversa criada e o request_id; assim não sobra conversa vazia a
// cada tentativa. Se a pessoa desiste, a conversa fica (vazia ou com a resposta que o
// servidor tenha gravado) e aparece na lista de conversas.
export function useRefreshPortfolio(userId: string) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RefreshState>({ kind: 'idle' })
  const attempt = useRef<{ key: string; conversationId: string | null; requestId: string | null } | null>(null)
  const busy = useRef(false)
  const abort = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller
    return () => controller.abort()
  }, [])

  const run = useCallback(
    async (symbols: string[], metrics: string[]): Promise<RefreshState | null> => {
      if (busy.current) return null
      busy.current = true
      const signal = abort.current.signal
      const key = JSON.stringify([symbols, metrics])
      if (!attempt.current || attempt.current.key !== key) attempt.current = { key, conversationId: null, requestId: null }
      const current = attempt.current
      const finish = (next: RefreshState) => {
        setState(next)
        return next
      }
      try {
        if (current.conversationId === null) {
          setState({ kind: 'creating' })
          try {
            current.conversationId = await createConversationWithId(userId, titleForRefresh(new Date()))
          } catch {
            return finish({ kind: 'error', view: CREATE_FAILED, conversationId: null })
          }
          void queryClient.invalidateQueries({ queryKey: conversationsKey(userId) })
        }
        const conversationId = current.conversationId
        current.requestId ??= newRequestId()
        setState({ kind: 'sending' })
        const outcome = await postAgentWithRetry(
          current.requestId,
          conversationId,
          { message: null, selection: { asset_ids: symbols, metrics } },
          signal,
          () => setState({ kind: 'waiting' }),
        )
        if (outcome === null) return null
        switch (outcome.kind) {
          case 'completed':
            attempt.current = null
            return finish({ kind: 'done', conversationId })
          case 'needs_selection':
            // Com `selection` o backend não chama o LLM; esta resposta não é esperada.
            attempt.current = null
            return finish({ kind: 'error', view: errorView('bad_response'), conversationId })
          case 'no_session':
            await supabase.auth.signOut()
            return finish({ kind: 'error', view: errorView(401), conversationId })
          case 'http_error':
            if (outcome.status === 401) await supabase.auth.signOut()
            else if (outcome.status === 403) await queryClient.invalidateQueries({ queryKey: authorizationKey(userId) })
            else if (outcome.status === 409) current.requestId = null // pedido novo, mesma conversa
            if (signal.aborted) return null
            return finish({ kind: 'error', view: errorView(outcome.status, outcome.code ?? undefined), conversationId })
          default:
            return finish({ kind: 'error', view: errorView(outcome.kind), conversationId })
        }
      } finally {
        busy.current = false
      }
    },
    [queryClient, userId],
  )

  const reset = useCallback(() => setState({ kind: 'idle' }), [])
  return { state, run, reset }
}
