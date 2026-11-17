import { expect, test } from 'vitest'
import formatSource from './format.ts?raw'
import { INVALID_VALUE_TEXT, formatDecimalString, isDecimalString } from './format'

const NBSP = ' '

test('preserva a escala do servidor', () => {
  expect(formatDecimalString('8.50', { unit: 'ratio' })).toBe('8,50')
  expect(formatDecimalString('8.5', { unit: 'ratio' })).toBe('8,5')
  expect(formatDecimalString('1.5000', { unit: 'ratio' })).toBe('1,5000')
  expect(formatDecimalString('12', { unit: 'ratio' })).toBe('12')
})

test('separador de milhar e vírgula decimal', () => {
  expect(formatDecimalString('1234.56', { unit: 'ratio' })).toBe('1.234,56')
  expect(formatDecimalString('1234567.89', { unit: 'ratio' })).toBe('1.234.567,89')
  expect(formatDecimalString('999', { unit: 'ratio' })).toBe('999')
  expect(formatDecimalString('1000', { unit: 'ratio' })).toBe('1.000')
  expect(formatDecimalString('100000', { unit: 'ratio' })).toBe('100.000')
})

test('negativos mantêm o sinal; zero não tem sinal', () => {
  expect(formatDecimalString('-1234.5', { unit: 'ratio' })).toBe('-1.234,5')
  expect(formatDecimalString('-0.01', { unit: 'ratio' })).toBe('-0,01')
  expect(formatDecimalString('-0', { unit: 'ratio' })).toBe('0')
  expect(formatDecimalString('-0.00', { unit: 'ratio' })).toBe('0,00')
})

test('zeros são exibidos como zeros, sem sumir nem virar outra coisa', () => {
  expect(formatDecimalString('0', { unit: 'ratio' })).toBe('0')
  expect(formatDecimalString('0.00', { unit: 'ratio' })).toBe('0,00')
  expect(formatDecimalString('0.60', { unit: 'percent_points' })).toBe('0,60 p.p.')
  expect(formatDecimalString('007.5', { unit: 'ratio' })).toBe('7,5')
})

test('percentual usa % e a escala de 0 a 100 do servidor', () => {
  expect(formatDecimalString('8.50', { unit: 'percent' })).toBe('8,50%')
  expect(formatDecimalString('9.10', { unit: 'percent' })).toBe('9,10%')
  expect(formatDecimalString('-3.2', { unit: 'percent' })).toBe('-3,2%')
  expect(formatDecimalString('1234.5', { unit: 'percent' })).toBe('1.234,5%')
})

test('BRL usa R$, no mínimo duas casas, sem cortar casas a mais', () => {
  expect(formatDecimalString('12', { unit: 'BRL' })).toBe(`R$${NBSP}12,00`)
  expect(formatDecimalString('1234.5', { unit: 'BRL' })).toBe(`R$${NBSP}1.234,50`)
  expect(formatDecimalString('10.123', { unit: 'BRL' })).toBe(`R$${NBSP}10,123`)
  expect(formatDecimalString('-5.25', { unit: 'BRL' })).toBe(`-R$${NBSP}5,25`)
})

test('scale só completa com zeros à direita, nunca arredonda', () => {
  expect(formatDecimalString('8.5', { unit: 'ratio', scale: 3 })).toBe('8,500')
  expect(formatDecimalString('8.567', { unit: 'ratio', scale: 1 })).toBe('8,567')
})

test('valores enormes (30+ dígitos) passam intactos, sem notação científica nem perda', () => {
  const big = '123456789012345678901234567890123.4567890123456789'
  expect(formatDecimalString(big, { unit: 'ratio' })).toBe('123.456.789.012.345.678.901.234.567.890.123,4567890123456789')
  expect(formatDecimalString('9'.repeat(40), { unit: 'BRL' })).toBe(
    `R$${NBSP}9.999.999.999.999.999.999.999.999.999.999.999.999.999,00`,
  )
  expect(formatDecimalString('-' + '1'.repeat(31), { unit: 'percent' })).toBe('-1.111.111.111.111.111.111.111.111.111.111%')
})

test('entradas inválidas devolvem "valor inválido", nunca NaN nem zero', () => {
  const invalid = ['', ' ', 'abc', '1,50', '1.2.3', '1e5', '+1', '.5', '5.', '--1', 'NaN', 'Infinity', '1 000', '１２', '8.50%', 'R$ 1']
  for (const value of invalid) {
    expect(formatDecimalString(value, { unit: 'ratio' }), JSON.stringify(value)).toBe(INVALID_VALUE_TEXT)
    expect(isDecimalString(value)).toBe(false)
  }
  for (const value of [null, undefined, 8.5, 0, {}, []] as unknown[]) {
    expect(formatDecimalString(value as string, { unit: 'percent' })).toBe(INVALID_VALUE_TEXT)
  }
  expect(INVALID_VALUE_TEXT).not.toMatch(/NaN|^0$/)
})

// Gerador determinístico (sem Math.random): a propriedade é reproduzível.
function lcg(seed: number) {
  let state = seed
  return () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296
}

test('propriedade: formatar não altera os dígitos (nem a ordem, nem a quantidade)', () => {
  const next = lcg(42)
  const digits = (length: number, noLeadingZero = false) => {
    let out = ''
    for (let i = 0; i < length; i++) {
      let d = Math.floor(next() * 10)
      if (noLeadingZero && i === 0 && d === 0) d = 1
      out += String(d)
    }
    return out
  }
  for (let i = 0; i < 500; i++) {
    const integer = next() < 0.1 ? '0' : digits(1 + Math.floor(next() * 40), true)
    const fraction = next() < 0.3 ? '' : digits(1 + Math.floor(next() * 12))
    const sign = next() < 0.3 ? '-' : ''
    const input = `${sign}${integer}${fraction ? '.' + fraction : ''}`
    for (const unit of ['ratio', 'percent', 'percent_points'] as const) {
      const out = formatDecimalString(input, { unit })
      expect(out.replace(/[^0-9]/g, ''), input).toBe(integer + fraction)
      // Volta ao decimal original só trocando os separadores.
      const body = out.replace(/%| p\.p\./, '').replace(/^-/, '')
      const [int = '', frac = ''] = body.split(',')
      expect(int.replaceAll('.', '') + (frac ? '.' + frac : ''), input).toBe(input.replace('-', ''))
    }
  }
})

test('o módulo de formatação não usa conversão numérica', () => {
  const source = formatSource.replace(/\/\/.*$/gm, '')
  expect(source).not.toMatch(/Number\(|parseFloat|parseInt|toFixed|NumberFormat|Math\.round/)
})
