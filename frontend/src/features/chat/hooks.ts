import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { authorizationKey } from '@/features/auth/hooks/useAuthorization'
import { supabase } from '@/lib/supabase'
import {
  chatConfig,
  fetchCatalog,
  fetchConversation,
  fetchMessagesPage,
  newRequestId,
  postAgent,
  type AgentRequest,
  type ChatMessage,
} from './api'
import { errorView, type AgentErrorView } from './texts'

export const conversationKey = (userId: string, id: string) => ['conversation', userId, id] as const
export const messagesKey = (userId: string, id: string) => ['messages', userId, id] as const
export const catalogKey = (userId: string) => ['catalog', userId] as const

export function useConversation(userId: string, id: string) {
  return useQuery({ queryKey: conversationKey(userId, id), queryFn: () => fetchConversation(id), staleTime: 0 })
}

export function useMessages(userId: string, id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: messagesKey(userId, id),
    queryFn: ({ pageParam }) => fetchMessagesPage(id, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.hasMore ? last.oldest : undefined),
    enabled,
    staleTime: 0,
  })
}

// Páginas vêm da mais recente para a mais antiga; a tela quer cronológico, sem repetição.
export function flattenMessages(pages: { items: ChatMessage[] }[] | undefined): ChatMessage[] {
  const seen = new Set<string>()
  const out: ChatMessage[] = []
  for (const page of [...(pages ?? [])].reverse()) {
    for (const message of page.items) {
      if (!seen.has(message.id)) {
        seen.add(message.id)
        out.push(message)
      }
    }
  }
  return out.sort((a, b) => a.sequence_no - b.sequence_no)
}

export function useCatalog(userId: string) {
  return useQuery({ queryKey: catalogKey(userId), queryFn: fetchCatalog, staleTime: 60_000, retry: 0 })
}

export type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'waiting' }
  | { kind: 'needs_selection'; code: string | null }
  | { kind: 'error'; view: AgentErrorView; request: AgentRequest }
  | { kind: 'done' }

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

// Envio para POST /agent.
// request_id: reutilizado quando a MESMA pergunta (mesmo texto e mesma seleção) é reenviada
// depois de uma falha sem resposta conclusiva (rede, tempo esgotado, 202, 5xx). É novo quando
// a pergunta ou a seleção muda, e depois de um envio que terminou (completed ou needs_selection).
// Sem atualização otimista (D17): depois da resposta as mensagens são relidas do banco.
export function useAgentSend(userId: string, conversationId: string, onCompleted: () => void) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<SendState>({ kind: 'idle' })
  const idRef = useRef<{ key: string; id: string } | null>(null)
  const busy = useRef(false)
  const abort = useRef(new AbortController())
  const onCompletedRef = useRef(onCompleted)
  useEffect(() => {
    onCompletedRef.current = onCompleted
  })

  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller
    return () => controller.abort()
  }, [])

  const reread = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: messagesKey(userId, conversationId) })
    } catch {
      // a própria consulta mostra o erro de leitura
    }
  }, [queryClient, userId, conversationId])

  const send = useCallback(
    async (request: AgentRequest): Promise<SendState | null> => {
      if (busy.current) return null
      busy.current = true
      const signal = abort.current.signal
      const key = JSON.stringify([request.message, request.selection])
      if (!idRef.current || idRef.current.key !== key) idRef.current = { key, id: newRequestId() }
      const requestId = idRef.current.id
      setState({ kind: 'sending' })
      const finish = (next: SendState) => {
        setState(next)
        return next
      }
      try {
        let outcome = await postAgent(requestId, conversationId, request, signal)
        for (let attempt = 1; outcome.kind === 'processing' && attempt < chatConfig.processingMaxAttempts; attempt++) {
          if (signal.aborted) return null
          setState({ kind: 'waiting' })
          await sleep(chatConfig.processingPauseMs, signal)
          if (signal.aborted) return null
          outcome = await postAgent(requestId, conversationId, request, signal)
        }
        if (signal.aborted) return null
        switch (outcome.kind) {
          case 'completed':
            idRef.current = null
            await reread()
            if (signal.aborted) return null
            onCompletedRef.current()
            return finish({ kind: 'done' })
          case 'needs_selection':
            idRef.current = null
            return finish({ kind: 'needs_selection', code: outcome.code })
          case 'no_session':
            await supabase.auth.signOut()
            return finish({ kind: 'error', view: errorView(401), request })
          case 'http_error':
            if (outcome.status === 401) {
              await supabase.auth.signOut()
            } else if (outcome.status === 403) {
              await queryClient.invalidateQueries({ queryKey: authorizationKey(userId) })
            } else {
              if (outcome.status === 409) idRef.current = null
              await reread()
            }
            if (signal.aborted) return null
            return finish({ kind: 'error', view: errorView(outcome.status, outcome.code ?? undefined), request })
          default:
            // network, timeout, bad_response, processing: o turno pode ter sido gravado.
            await reread()
            if (signal.aborted) return null
            return finish({ kind: 'error', view: errorView(outcome.kind), request })
        }
      } finally {
        busy.current = false
      }
    },
    [conversationId, queryClient, reread, userId],
  )

  const reset = useCallback(() => setState({ kind: 'idle' }), [])
  return { state, send, reset }
}
