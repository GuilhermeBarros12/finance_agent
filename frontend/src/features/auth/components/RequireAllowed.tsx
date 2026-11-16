import { useEffect, useRef } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/state'
import { useAuthorization } from '../hooks/useAuthorization'
import { useSession } from '../hooks/sessionContext'

// Dentro de RequireAuth. Só deixa passar quem está em `allowed_users` e habilitado.
// Quem não está vai para /entrar, onde a mensagem de acesso não autorizado aparece.
// Erro de leitura não é "não autorizado": mostra erro com nova tentativa.
// A autorização é relida do banco a cada mudança de rota privada (e quando a lista de
// conversas volta vazia, ver ConversationsPage). Enquanto relê, o conteúdo anterior fica
// na tela (sem piscar carregamento); só o resultado novo, "negado" ou erro, o tira.
export function RequireAllowed() {
  const state = useSession()
  const userId = state.status === 'ready' ? state.session?.user.id : undefined
  const authorization = useAuthorization(userId)
  const { pathname } = useLocation()
  const lastPath = useRef(pathname)
  const { refetch } = authorization

  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    void refetch()
  }, [pathname, refetch])

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
