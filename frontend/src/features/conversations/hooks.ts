import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createConversation,
  deleteConversation,
  listConversations,
  renameConversation,
} from './api'

export const conversationsKey = (userId: string) => ['conversations', userId] as const

export function useConversations(userId: string) {
  return useQuery({ queryKey: conversationsKey(userId), queryFn: listConversations })
}

// Sem atualização otimista (D17): depois de cada escrita, com sucesso ou erro, a lista
// é relida do banco. A mutação só termina quando a releitura termina.
function useWrite<V>(userId: string, write: (v: V) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: write,
    onSettled: () => queryClient.invalidateQueries({ queryKey: conversationsKey(userId) }),
  })
}

export function useCreateConversation(userId: string) {
  return useWrite<void>(userId, () => createConversation(userId))
}

export function useRenameConversation(userId: string) {
  return useWrite<{ id: string; title: string }>(userId, ({ id, title }) => renameConversation(id, title))
}

export function useDeleteConversation(userId: string) {
  return useWrite<string>(userId, deleteConversation)
}
