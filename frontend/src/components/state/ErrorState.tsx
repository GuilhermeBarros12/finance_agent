import { AlertOctagon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({ title = 'Não foi possível carregar', message, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="rounded-painel border-2 border-carmim p-6">
      <h2 className="flex items-center gap-2 text-subtitulo text-carmim">
        <AlertOctagon aria-hidden="true" className="size-5" />
        {title}
      </h2>
      <p className="mt-2 max-w-prose">{message}</p>
      {onRetry ? (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Tentar de novo
        </Button>
      ) : null}
    </div>
  )
}
