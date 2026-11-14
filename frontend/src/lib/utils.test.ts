import { expect, test } from 'vitest'
import { cn } from './utils'

test('cn mantém tamanho do guia e cor juntos', () => {
  expect(cn('text-nota', 'text-tinta')).toBe('text-nota text-tinta')
  expect(cn('text-rotulo', 'text-papel')).toBe('text-rotulo text-papel')
})

test('cn ainda resolve conflito entre dois tamanhos', () => {
  expect(cn('text-nota', 'text-tela')).toBe('text-tela')
})
