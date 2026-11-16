import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type SessionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: Session | null }

export const SessionContext = createContext<SessionState>({ status: 'loading' })

export function useSession() {
  return useContext(SessionContext)
}
