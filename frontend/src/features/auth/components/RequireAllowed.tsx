import { Navigate, Outlet } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/state'
import { useAuthorization } from '../hooks/useAuthorization'
import { useSession } from '../hooks/sessionContext'

// Dentro de RequireAuth. Só deixa passar quem está em `allowed_users` e habilitado.
// Quem não está vai para /entrar, onde a mensagem de acesso não autorizado aparece.
// Erro de leitura não é "não autorizado": mostra erro com nova tentativa.
export function RequireAllowed() {
  const state = useSession()
  const userId = state.status === 'ready' ? state.session?.user.id : undefined
  const authorization = useAuthorization(userId)

  if (authorization.isPending) return <LoadingState label="Verificando acesso..." />
  if (authorization.isError) {
    return (
      <ErrorState
        title="Não foi possível verificar o acesso"
        message="A leitura da autorização falhou. Isso não significa que o acesso foi negado."
        onRetry={() => void authorization.refetch()}
      />
    )
  }
  if (authorization.data !== 'allowed') return <Navigate to="/entrar" replace />
  return <Outlet />
}
