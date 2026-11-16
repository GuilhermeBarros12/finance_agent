import { useQuery } from '@tanstack/react-query'
import { fetchAuthorization } from '../api'

export function useAuthorization(userId: string | undefined) {
  return useQuery({
    queryKey: ['authorization', userId],
    queryFn: () => fetchAuthorization(userId as string),
    enabled: Boolean(userId),
  })
}
