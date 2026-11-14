import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Equal,
  Hourglass,
  Timer,
  TimerOff,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { FreshnessStatus, ValidationStatus } from './states'

export interface Visual {
  label: string
  Icon: LucideIcon
  className: string
}

// Tabela de docs/design.md: ícone + texto + formato de borda + cor.
export const VALIDATION_VISUAL: Record<ValidationStatus, Visual> = {
  verified: { label: 'Conferido', Icon: CheckCircle2, className: 'border border-solid border-verde-conferido text-verde-conferido' },
  divergent: { label: 'Divergente', Icon: AlertTriangle, className: 'border-2 border-solid border-ambar-alerta text-ambar-alerta' },
  single_source: { label: 'Fonte única', Icon: CircleSlash, className: 'border border-solid border-tinta-suave text-tinta-suave' },
  incomparable: { label: 'Não comparável', Icon: Equal, className: 'border border-dashed border-tinta-suave text-tinta-suave' },
  missing: { label: 'Sem dado', Icon: CircleDashed, className: 'border border-dotted border-tinta-suave text-tinta-suave' },
  invalid: { label: 'Inválido', Icon: XCircle, className: 'border-2 border-solid border-carmim text-carmim' },
}

export const FRESHNESS_VISUAL: Record<FreshnessStatus, Visual> = {
  fresh: { label: 'Atualizado', Icon: Timer, className: 'border border-solid border-verde-conferido text-verde-conferido' },
  stale: { label: 'Desatualizado', Icon: Hourglass, className: 'border-2 border-solid border-ambar-alerta text-ambar-alerta' },
  expired: { label: 'Vencido', Icon: TimerOff, className: 'border-2 border-dashed border-carmim text-carmim' },
}

