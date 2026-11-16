import { EmptyState } from '@/components/state'

// Marcador de rota. A tela real vem da tarefa indicada em `descricao`.
export function Placeholder({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <section>
      <h1 className="text-tela">{titulo}</h1>
      <div className="mt-4">
        <EmptyState title="Esta tela ainda não foi construída" description={descricao} />
      </div>
    </section>
  )
}
