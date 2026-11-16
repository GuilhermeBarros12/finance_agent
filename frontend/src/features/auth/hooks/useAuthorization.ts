import { useQuery } from '@tanstack/react-query'
import { fetchAuthorization } from '../api'

export const authorizationKey = (userId: string | undefined) => ['authorization', userId] as const

export function useAuthorization(userId: string | undefined) {
  return useQuery({
    queryKey: authorizationKey(userId),
    queryFn: () => fetchAuthorization(userId as string),
    enabled: Boolean(userId),
    staleTime: 0,
    refetchOnMount: 'always',
  })
}
