import { ErrorState, LoadingState } from '@/components/state'
import { useSession } from '@/features/auth/hooks/sessionContext'
import { useCatalog } from '@/features/chat/hooks'
import { CatalogError } from '@/features/chat/api'
import { ExportPanel } from './ExportPanel'
import { SnapshotPanel } from './SnapshotPanel'
import { SourcesList } from './SourcesList'

function catalogMessage(error: unknown): string {
  const status = error instanceof CatalogError ? error.status : null
  if (status === 401 || status === 403) return 'O servidor não autorizou a leitura do estado dos dados.'
  if (status === null) return 'Sem resposta ou resposta em formato inesperado. Nada foi exibido como dado.'
  return 'Algo falhou do lado do servidor. Nada foi exibido como dado.'
}

export function DataStatusPage() {
  const session = useSession()
  const userId = session.status === 'ready' ? (session.session?.user.id ?? '') : ''
  const catalog = useCatalog(userId)

  return (
    <div className="min-w-0 max-w-3xl space-y-8 [overflow-wrap:break-word]">
      <div>
        <h1 className="text-tela">Dados</h1>
        <p className="mt-2 max-w-prose text-tinta-suave">
          Estado do último lote coletado, fontes usadas e exportação dos seus dados.
        </p>
      </div>

      {/* Região viva só para mensagens curtas; o painel inteiro (com a lista de falhas) não é anunciado. */}
      <div aria-live="polite" className="min-w-0">
        {catalog.isPending || (catalog.isError && catalog.isFetching) ? (
          <LoadingState label="Carregando o estado dos dados..." />
        ) : null}
        {catalog.isError && !catalog.isFetching ? (
          <ErrorState
            title="Não foi possível carregar o estado dos dados"
            message={catalogMessage(catalog.error)}
            onRetry={() => void catalog.refetch()}
          />
        ) : null}
        {catalog.data ? <p className="sr-only">Estado dos dados carregado.</p> : null}
      </div>
      {catalog.data ? <SnapshotPanel catalog={catalog.data} /> : null}

      <SourcesList />
      <ExportPanel />
    </div>
  )
}
