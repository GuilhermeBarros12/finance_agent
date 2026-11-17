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
  if (text.length <= SHORT_VALUE_MAX) return <span className={cn('whitespace-nowrap', className)}>{text}</span>
  // Valor longo: o sinal, o "R$" e os primeiros dígitos ficam juntos, e os últimos dígitos
  // ficam junto do "%" ou "p.p."; só o meio quebra em qualquer ponto.
  const head = /^-?(?:R\$\u00a0)?[0-9]{1,3}/.exec(text)?.[0] ?? ''
  const tail = /[0-9](?:%| p\.p\.)?$/.exec(text)?.[0] ?? ''
  if (head.length + tail.length >= text.length) return <span className={cn('[overflow-wrap:anywhere]', className)}>{text}</span>
  return (
    <span className={cn('[overflow-wrap:anywhere]', className)}>
      <span className="whitespace-nowrap">{head}</span>
      {text.slice(head.length, text.length - tail.length)}
      <span className="whitespace-nowrap">{tail}</span>
    </span>
  )
}
