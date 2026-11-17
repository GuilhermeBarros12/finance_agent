import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode // decorativo (aria-hidden); o título já diz o mesmo
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="rounded-painel border border-dashed border-borda p-6">
      <h2 className="flex items-center gap-2 text-subtitulo">
        {icon ? <span aria-hidden="true" className="shrink-0">{icon}</span> : null}
        {title}
      </h2>
      <p className="mt-2 max-w-prose text-tinta-suave">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
