import { expect, test } from 'vitest'
import { safeSourceUrl } from './safeLink'

test('aceita só https em domínios das fontes', () => {
  expect(safeSourceUrl('https://www.fundamentus.com.br/detalhes.php?papel=DEMO3')).toBe('https://www.fundamentus.com.br/detalhes.php?papel=DEMO3')
  expect(safeSourceUrl('https://statusinvest.com.br/acoes/demo3')).toBe('https://statusinvest.com.br/acoes/demo3')
  expect(safeSourceUrl('https://brapi.dev/api/quote/DEMO3')).not.toBeNull()
})

test.each([
  'http://statusinvest.com.br/acoes/demo3',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'ftp://statusinvest.com.br/x',
  '//statusinvest.com.br/x',
  'https://statusinvest.com.br.evil.com/x',
  'https://evilstatusinvest.com.br/x',
  'https://evil.example/statusinvest.com.br',
  'https://user:pw@statusinvest.com.br/x',
  'https://statusinvest.com.br:8443/x',
  '',
  'não é url',
])('descarta %s', (url) => {
  expect(safeSourceUrl(url)).toBeNull()
})

test('descarta o que não é texto', () => {
  expect(safeSourceUrl(null)).toBeNull()
  expect(safeSourceUrl(42)).toBeNull()
  expect(safeSourceUrl({})).toBeNull()
})
