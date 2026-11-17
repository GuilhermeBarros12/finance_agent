import { XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INVALID_VALUE_TEXT, formatDecimalString, isDecimalString, type ValueUnit } from '../format'

// Até este tamanho (em caracteres, já formatado) o valor é "curto": cabe em 320 px sem quebrar.
export const SHORT_VALUE_MAX = 18

// Único ponto da tela que mostra um valor decimal. Valor ilegível mostra ícone e
// "valor inválido", nunca zero nem NaN.
export function Value({ value, unit, className }: { value: string; unit: ValueUnit; className?: string }) {
  if (!isDecimalString(value)) {
    return (
      <span className="inline-flex items-center gap-1 text-carmim whitespace-nowrap">
        <XCircle aria-hidden="true" className="size-4 shrink-0" />
        {INVALID_VALUE_TEXT}
      </span>
    )
  }
  const text = formatDecimalString(value, { unit })
  // Valor curto nunca quebra (ler "R$ 0," e "01" em linhas separadas engana). Valor longo
  // quebra em qualquer ponto, para não gerar rolagem horizontal (WCAG 1.4.10).
  const long = text.length > SHORT_VALUE_MAX
  return <span className={cn(long ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap', className)}>{text}</span>
}
