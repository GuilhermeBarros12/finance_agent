import { LogIn, ShieldAlert, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ErrorState, LoadingState } from '@/components/state'
import { Button } from '@/components/ui/button'
import { signInWithGoogle } from '../api'
import { useAuthorization } from '../hooks/useAuthorization'
import { useSession } from '../hooks/sessionContext'
import { SignOutButton } from './SignOutButton'

// Região fixa na página; o alerta só existe quando há mensagem (anunciada ao aparecer).
function Notice({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive">
      {message ? (
        <p role="alert" className="flex items-start gap-2 text-carmim">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 p-4 md:p-8">
      <div>
        <p className="font-serif text-subtitulo font-semibold">Agente de Investimentos</p>
        <h1 className="mt-2 text-tela">Entrar</h1>
      </div>
      {children}
    </main>
  )
}

function SignedIn({ userId }: { userId: string }) {
  const location = useLocation()
  const authorization = useAuthorization(userId)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const from = (location.state as { from?: string } | null)?.from

  if (authorization.isPending) {
    return (
      <Shell>
        <LoadingState label="Verificando acesso..." />
      </Shell>
    )
  }
  if (authorization.isError) {
    return (
      <Shell>
        <ErrorState
          title="Não foi possível verificar o acesso"
          message="A leitura da autorização falhou. Isso não significa que o acesso foi negado."
          onRetry={() => void authorization.refetch()}
        />
        <SignOutButton onError={setSignOutError} />
        <Notice message={signOutError} />
      </Shell>
    )
  }
  if (authorization.data === 'allowed') return <Navigate to={from ?? '/'} replace />
  return (
    <Shell>
      <div role="alert" className="rounded-painel border-2 border-carmim p-6">
        <h2 className="flex items-center gap-2 text-subtitulo text-carmim">
          <ShieldAlert aria-hidden="true" className="size-5" />
          Acesso não autorizado
        </h2>
        <p className="mt-2 max-w-prose">
          Esta conta Google não está na lista de pessoas com acesso. Saia e entre com outra conta, ou peça a
          liberação a quem administra o sistema.
        </p>
      </div>
      <SignOutButton onError={setSignOutError} />
      <Notice message={signOutError} />
    </Shell>
  )
}

export function LoginPage() {
  const state = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (state.status === 'loading') {
    return (
      <Shell>
        <LoadingState label="Verificando sessão..." />
      </Shell>
    )
  }
  if (state.status === 'error') {
    return (
      <Shell>
        <ErrorState
          title="Sessão indisponível"
          message={state.message}
          onRetry={() => window.location.reload()}
        />
      </Shell>
    )
  }
  if (state.session) return <SignedIn userId={state.session.user.id} />

  async function handleSignIn() {
    setPending(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch {
      setError('Não foi possível iniciar a entrada com Google. Tente de novo.')
      setPending(false)
    }
  }

  return (
    <Shell>
      <p className="max-w-prose text-tinta-suave">
        O acesso é restrito a contas autorizadas. Entre com a conta Google liberada para você.
      </p>
      <Button onClick={() => void handleSignIn()} disabled={pending}>
        <LogIn aria-hidden="true" className="size-5" />
        Entrar com Google
      </Button>
      <Notice message={error} />
    </Shell>
  )
}
