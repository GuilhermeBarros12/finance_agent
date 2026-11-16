import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/state'
import { useSession } from '../hooks/sessionContext'

// Rotas privadas: sem sessão, vai para /entrar.
export function RequireAuth() {
  const state = useSession()
  const location = useLocation()

  if (state.status === 'loading') return <LoadingState label="Verificando sessão..." />
  if (state.status === 'error') {
    return <ErrorState title="Sessão indisponível" message={state.message} onRetry={() => window.location.reload()} />
  }
  if (!state.session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return <Outlet />
}
