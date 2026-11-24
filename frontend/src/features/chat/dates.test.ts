import { expect, test } from 'vitest'
import { formatAge } from './dates'

test('formatAge: faixas, fronteiras, virada de dia em Brasília, futuro e inválido', () => {
  const at = (iso: string) => new Date(iso)
  const c = '2026-09-18T20:05:00+00:00'
  expect(formatAge(c, at('2026-09-18T20:05:00Z'))).toBe('agora há pouco')
  expect(formatAge(c, at('2026-09-18T20:09:59Z'))).toBe('agora há pouco')
  expect(formatAge(c, at('2026-09-18T20:10:00Z'))).toBe('há menos de 1 hora')
  expect(formatAge(c, at('2026-09-18T21:04:59Z'))).toBe('há menos de 1 hora')
  expect(formatAge(c, at('2026-09-18T21:05:00Z'))).toBe('há 1 hora')
  expect(formatAge(c, at('2026-09-18T22:05:00Z'))).toBe('há 2 horas')
  expect(formatAge(c, at('2026-09-19T20:04:59Z'))).toBe('há 23 horas')
  expect(formatAge(c, at('2026-09-19T20:05:00Z'))).toBe('há 1 dia')
  expect(formatAge(c, at('2026-09-21T20:05:00Z'))).toBe('há 3 dias')
  // virada de dia em Brasília (23:50 BRT -> 00:10 BRT do dia seguinte): 20 minutos, não "1 dia"
  expect(formatAge('2026-09-19T02:50:00Z', at('2026-09-19T03:10:00Z'))).toBe('há menos de 1 hora')
  // coleta até 5 min à frente: tolerância; além disso, futuro
  expect(formatAge(c, at('2026-09-18T20:00:01Z'))).toBe('agora há pouco')
  expect(formatAge(c, at('2026-09-18T20:00:00Z'))).toBe('agora há pouco')
  expect(formatAge(c, at('2026-09-18T19:59:59Z'))).toBe('data de coleta no futuro')
  expect(formatAge('ontem', at('2026-09-18T20:05:00Z'))).toBe('idade indisponível')
  expect(formatAge('', at('2026-09-18T20:05:00Z'))).toBe('idade indisponível')
  expect(formatAge('2026-13-45T99:99', at('2026-09-18T20:05:00Z'))).toBe('idade indisponível')
  expect(formatAge(c, new Date(Number.NaN))).toBe('idade indisponível')
})
