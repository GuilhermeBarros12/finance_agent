import { Loader2 } from 'lucide-react'

export function LoadingState({ label = 'Carregando...' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-tinta-suave">
      <Loader2 aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  )
}
