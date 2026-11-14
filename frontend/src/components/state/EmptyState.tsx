import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-painel border border-dashed border-borda p-6">
      <h2 className="text-subtitulo">{title}</h2>
      <p className="mt-2 max-w-prose text-tinta-suave">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
