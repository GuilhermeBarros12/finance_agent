import { useEffect, useState, type ReactNode } from 'react'
import { fetchSession, subscribeToSession } from '../api'
import { SessionContext, type SessionState } from './sessionContext'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    fetchSession().then(
      (session) => active && setState({ status: 'ready', session }),
      () => active && setState({ status: 'error', message: 'Não foi possível verificar a sessão.' }),
    )
    const unsubscribe = subscribeToSession((session) => {
      if (active) setState({ status: 'ready', session })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}
