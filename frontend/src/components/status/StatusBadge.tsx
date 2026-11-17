import { cn } from '@/lib/utils'
import { FRESHNESS_VISUAL, VALIDATION_VISUAL, type Visual } from './visuals'
import type { FreshnessStatus, ValidationStatus } from './states'

function Badge({ visual, prefix }: { visual: Visual; prefix: string }) {
  const { Icon, label, className } = visual
  return (
    <span
      role="img"
      aria-label={`${prefix}: ${label}`}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-selo px-2 py-0.5 text-nota font-medium', className)}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span aria-hidden="true">{label}</span>
    </span>
  )
}

export function StatusBadge({ status }: { status: ValidationStatus }) {
  return <Badge visual={VALIDATION_VISUAL[status]} prefix="Estado da validação" />
}

export function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  return <Badge visual={FRESHNESS_VISUAL[status]} prefix="Estado da atualização" />
}
