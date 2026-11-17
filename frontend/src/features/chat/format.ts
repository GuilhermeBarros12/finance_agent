// Formatação pt-BR de valores decimais. É a ÚNICA função de exibição de valor de mercado
// do navegador (D21, regras do plano). Trabalha só sobre a string decimal do servidor:
// separa os dígitos, põe o ponto de milhar e a vírgula decimal. Não converte para número,
// não soma, não compara e não arredonda: os dígitos que saem são os que entraram.

export type ValueUnit = 'ratio' | 'percent' | 'BRL' | 'percent_points'

export interface FormatOptions {
  unit: ValueUnit
  // Mínimo de casas decimais. Só completa com zeros à direita (8 vira 8,00 com scale 2);
  // nunca corta nem arredonda casas que o servidor mandou.
  scale?: number
}

export const INVALID_VALUE_TEXT = 'valor inválido'

// Mesmo padrão de DecimalStr em collector/contracts.py: sem expoente, NaN, espaço ou milhar.
const DECIMAL = /^(-?)([0-9]+)(?:\.([0-9]+))?$/

export function isDecimalString(value: unknown): value is string {
  return typeof value === 'string' && DECIMAL.test(value)
}

function group(integer: string): string {
  let out = ''
  for (let end = integer.length; end > 0; end -= 3) {
    const start = Math.max(0, end - 3)
    out = integer.slice(start, end) + (out ? '.' + out : '')
  }
  return out
}

// Devolve o texto pronto para a tela, ou "valor inválido" se a entrada não for um decimal
// bem formado. Nunca devolve NaN nem zero no lugar de um valor ilegível.
export function formatDecimalString(value: string, options: FormatOptions): string {
  const match = typeof value === 'string' ? DECIMAL.exec(value) : null
  if (!match) return INVALID_VALUE_TEXT
  const [, sign, rawInteger, fraction = ''] = match
  // Zeros à esquerda não carregam valor ("007" é "7"); o servidor já não os manda.
  const integer = rawInteger.replace(/^0+(?=[0-9])/, '')
  const minScale = options.scale ?? (options.unit === 'BRL' ? 2 : 0)
  const padded = fraction.length < minScale ? fraction + '0'.repeat(minScale - fraction.length) : fraction
  const number = group(integer) + (padded ? ',' + padded : '')
  // Zero não tem sinal ("-0,00" seria ruído); qualquer outro valor mantém o menos.
  const isZero = /^0*$/.test(integer + fraction)
  const minus = sign === '-' && !isZero ? '-' : ''
  switch (options.unit) {
    case 'percent':
      return `${minus}${number}%`
    case 'percent_points':
      return `${minus}${number} p.p.`
    case 'BRL':
      return `${minus}R$ ${number}`
    default:
      return `${minus}${number}`
  }
}
