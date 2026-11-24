import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/state'
import { ScreenFrame } from '@/features/legal/components/ScreenFrame'
import { useSession } from '../hooks/sessionContext'

// Rotas privadas: sem sessão, vai para /entrar.
export function RequireAuth() {
  const state = useSession()
  const location = useLocation()

  if (state.status === 'loading') {
    return (
      <ScreenFrame>
        <LoadingState label="Verificando sessão..." />
      </ScreenFrame>
    )
  }
  if (state.status === 'error') {
    return (
      <ScreenFrame>
        <ErrorState title="Sessão indisponível" message={state.message} onRetry={() => window.location.reload()} />
      </ScreenFrame>
    )
  }
  if (!state.session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return <Outlet />
}
