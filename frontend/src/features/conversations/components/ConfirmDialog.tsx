import { Trash2 } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

// Durante a exclusão os botões usam aria-disabled (não `disabled`): continuam focáveis e o
// Tab não escapa para a página atrás.
// Diálogo de confirmação destrutiva. Foco inicial em "Cancelar" (o lado seguro),
// Tab fica dentro do diálogo, Esc cancela e o foco volta a quem abriu.
export function ConfirmDialog({ title, description, confirmLabel, pending, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    // Se quem abriu já saiu da página (ex.: conversa excluída), quem chamou decide o foco.
    return () => {
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!pending) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-sobreposicao p-4 overflow-y-auto" onKeyDown={onKeyDown}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="m-auto w-full max-w-md rounded-painel border-2 border-carmim bg-superficie p-6"
      >
        <h2 id={titleId} className="text-subtitulo">
          {title}
        </h2>
        <p id={descId} className="mt-2 max-w-prose">
          {description}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="outline" onClick={() => !pending && onCancel()} aria-disabled={pending || undefined}>
            Cancelar
          </Button>
          <Button
            onClick={() => !pending && onConfirm()}
            aria-disabled={pending || undefined}
            className="border-2 border-carmim bg-carmim text-papel"
          >
            <Trash2 aria-hidden="true" className="size-5" />
            {pending ? 'Excluindo...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
