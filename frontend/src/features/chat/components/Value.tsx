import { XCircle } from 'lucide-react'
import { INVALID_VALUE_TEXT, formatDecimalString, isDecimalString, type ValueUnit } from '../format'

// Único ponto da tela que mostra um valor decimal. Valor ilegível mostra ícone e
// "valor inválido", nunca zero nem NaN.
export function Value({ value, unit, className }: { value: string; unit: ValueUnit; className?: string }) {
  if (!isDecimalString(value)) {
    return (
      <span className="inline-flex items-center gap-1 text-carmim">
        <XCircle aria-hidden="true" className="size-4 shrink-0" />
        {INVALID_VALUE_TEXT}
      </span>
    )
  }
  return <span className={className}>{formatDecimalString(value, { unit })}</span>
}
