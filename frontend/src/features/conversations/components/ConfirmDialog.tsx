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
    return () => opener?.focus?.()
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/60 p-4" onKeyDown={onKeyDown}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-painel border-2 border-carmim bg-superficie p-6"
      >
        <h2 id={titleId} className="text-subtitulo">
          {title}
        </h2>
        <p id={descId} className="mt-2 max-w-prose">
          {description}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="outline" onClick={onCancel} disabled={pending}>
            Cancelar
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
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
