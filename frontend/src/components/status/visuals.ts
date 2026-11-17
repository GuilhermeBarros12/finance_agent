import {
  AlertTriangle,
  Ban,
  CalendarX,
  CheckCircle2,
  CircleDot,
  CircleMinus,
  ClockAlert,
  ClockCheck,
  EqualNot,
  Hourglass,
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
  single_source: { label: 'Fonte única', Icon: CircleDot, className: 'border border-solid border-tinta-suave text-tinta-suave' },
  incomparable: { label: 'Não comparável', Icon: EqualNot, className: 'border border-dashed border-tinta-suave text-tinta-suave' },
  missing: { label: 'Sem dado', Icon: CircleMinus, className: 'border border-dotted border-tinta-suave text-tinta-suave' },
  not_applicable: { label: 'Não se aplica', Icon: Ban, className: 'border-[3px] border-double border-tinta-suave text-tinta-suave' },
  invalid: { label: 'Inválido', Icon: XCircle, className: 'border-2 border-solid border-carmim text-carmim' },
}

export const FRESHNESS_VISUAL: Record<FreshnessStatus, Visual> = {
  fresh: { label: 'Atualizado', Icon: ClockCheck, className: 'border border-solid border-verde-conferido text-verde-conferido' },
  stale: { label: 'Desatualizado', Icon: Hourglass, className: 'border-2 border-solid border-ambar-alerta text-ambar-alerta' },
  expired: { label: 'Vencido', Icon: ClockAlert, className: 'border-2 border-solid [border-bottom-style:dashed] border-carmim text-carmim' },
  unknown_reference_date: { label: 'Data-base desconhecida', Icon: CalendarX, className: 'border border-dotted border-ambar-alerta text-ambar-alerta' },
}

