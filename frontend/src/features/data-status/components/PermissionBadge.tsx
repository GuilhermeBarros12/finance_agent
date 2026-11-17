import { ShieldCheck, ShieldOff, ShieldQuestionMark, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PERMISSION_LABEL, type PermissionStatus } from '../sources'

// Mesmo formato do selo de estado (docs/design.md): ícone, texto e borda própria; a cor só reforça.
const VISUAL: Record<PermissionStatus, { Icon: LucideIcon; className: string }> = {
  permitida: { Icon: ShieldCheck, className: 'border border-solid border-verde-conferido text-verde-conferido' },
  indefinida: { Icon: ShieldQuestionMark, className: 'border-2 border-dashed border-ambar-alerta text-ambar-alerta' },
  proibida: { Icon: ShieldOff, className: 'border-2 border-solid border-carmim text-carmim' },
}

export function PermissionBadge({ status }: { status: PermissionStatus }) {
  const { Icon, className } = VISUAL[status]
  const label = PERMISSION_LABEL[status]
  return (
    <span
      role="img"
      aria-label={`Permissão de coleta: ${label}`}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-selo px-2 py-0.5 text-nota font-medium', className)}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span aria-hidden="true">{label}</span>
    </span>
  )
}
