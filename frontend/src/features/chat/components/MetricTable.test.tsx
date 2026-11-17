import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import type { FreshnessStatus } from '@/components/status'
import { readCatalog, readPayload, type AnswerPayload } from '../contracts'
import { catalogBody, defaultSnapshot, obs, seedPayload, val } from '../fixtures'
import { MetricTable } from './MetricTable'

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia')
})

function payloadOf(raw: Record<string, unknown>): AnswerPayload {
  const parsed = readPayload(raw)
  if (!parsed) throw new Error('payload de teste inválido')
  return parsed
}

const cell = (asset: string, metric: string) => screen.getByTestId(`cell-${asset}-${metric}`)

function sevenStates(): Record<string, unknown> {
  const raw = seedPayload()
  const evidence = raw.evidence as { validations: unknown[]; observations: unknown[] }
  evidence.validations.push(
    val('v-single', 'ONEA3', 'price_to_book', 'single_source', ['o7']),
    val('v-na', 'ONEA3', 'roe', 'not_applicable', [], { reason: 'Banco não usa este indicador' }),
    val('v-inv', 'ONEA3', 'quote_price', 'invalid', ['o8'], { reason: 'Fora do intervalo plausível' }),
  )
  evidence.observations.push(obs('o7', 'ONEA3', 'price_to_book', '0.90'), obs('o8', 'ONEA3', 'quote_price', '-5'))
  const sections = raw.sections as Record<string, unknown>[]
  ;(sections[0].validation_ids as string[]).push('v-single')
  ;(sections[2].validation_ids as string[]).push('v-na', 'v-inv')
  return raw
}

test('renderiza os sete estados de validação, cada um com o texto do selo', () => {
  render(<MetricTable payload={payloadOf(sevenStates())} />)
  const labels: [string, string, string][] = [
    ['DEMO3', 'price_to_book', 'Conferido'],
    ['DEMO3', 'dividend_yield', 'Divergente'],
    ['ONEA3', 'price_to_book', 'Fonte única'],
    ['TEST4', 'price_to_earnings', 'Não comparável'],
    ['TEST4', 'roe', 'Sem dado'],
    ['ONEA3', 'roe', 'Não se aplica'],
    ['ONEA3', 'quote_price', 'Inválido'],
  ]
  for (const [asset, metric, label] of labels) {
    expect(within(cell(asset, metric)).getByRole('img', { name: `Estado da validação: ${label}` }), `${asset} ${metric}`).toBeTruthy()
  }
})

test('cabeçalho: data do snapshot em Brasília, manifesto e estado de atualização', () => {
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  const header = screen.getByRole('banner')
  expect(within(header).getByText(/18\/09\/2026/).textContent).toContain('17:05')
  expect(within(header).getByText('11 de 12 ativos atualizados')).toBeTruthy()
  expect(within(header).getByRole('img', { name: /Estado da atualização/ })).toBeTruthy()
})

test.each<[FreshnessStatus, string, boolean]>([
  ['fresh', 'Atualizado', false],
  ['stale', 'Desatualizado', true],
  ['expired', 'Vencido', true],
  ['unknown_reference_date', 'Data-base desconhecida', false],
])('estado de atualização %s: selo "%s", aviso no cabeçalho: %s', (freshness, label, warns) => {
  const raw = seedPayload()
  const validations = (raw.evidence as { validations: { freshness: string }[] }).validations
  for (const v of validations) v.freshness = freshness
  render(<MetricTable payload={payloadOf(raw)} />)
  const header = screen.getByRole('banner')
  expect(within(header).getByRole('img', { name: `Estado da atualização: ${label}` })).toBeTruthy()
  expect(/desatualizados|vencidos/.test(header.textContent ?? '')).toBe(warns)
})

test('o estado atual do catálogo vence o da resposta quando é o mesmo snapshot', () => {
  const catalog = readCatalog(catalogBody(defaultSnapshot('expired')))
  render(<MetricTable payload={payloadOf(seedPayload())} catalog={catalog} />)
  const header = screen.getByRole('banner')
  expect(within(header).getByRole('img', { name: 'Estado da atualização: Vencido' })).toBeTruthy()
  expect(header.textContent).toContain('estado atual do lote')
  expect(header.textContent).toContain('Dados vencidos')
})

test('o catálogo de outro snapshot não é usado', () => {
  const body = catalogBody({ ...defaultSnapshot('expired'), snapshot_id: 'outro' })
  render(<MetricTable payload={payloadOf(seedPayload())} catalog={readCatalog(body)} />)
  expect(within(screen.getByRole('banner')).getByRole('img', { name: 'Estado da atualização: Data-base desconhecida' })).toBeTruthy()
})

test('verified: valor do Fundamentus em destaque; o do StatusInvest só ao expandir', () => {
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  const c = cell('DEMO3', 'price_to_book')
  expect(within(c).getByText('1,50')).toBeTruthy()
  expect(within(c).queryByText('1,51')).toBeNull()
  const toggle = within(c).getByRole('button', { name: 'Ver as outras fontes' })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle)
  expect(within(c).getByRole('button', { name: 'Ocultar as outras fontes' }).getAttribute('aria-expanded')).toBe('true')
  expect(within(c).getByText('1,51')).toBeTruthy()
  expect(within(c).getByText('0,01')).toBeTruthy()
  expect(within(c).getByText('0,0302')).toBeTruthy()
})

test('divergent: os dois valores, a diferença e o limite do servidor, nenhum lado em destaque', () => {
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  const c = cell('DEMO3', 'dividend_yield')
  const a = within(c).getByText('8,50%')
  const b = within(c).getByText('9,10%')
  // Mesmo elemento, mesmas classes: nada de peso, tamanho ou cor diferente entre os lados.
  expect(a.parentElement?.className).toBe(b.parentElement?.className)
  expect(a.parentElement?.parentElement?.className).toBe(b.parentElement?.parentElement?.className)
  expect(within(c).getByText('0,60 p.p.')).toBeTruthy()
  expect(within(c).getByText('0,20 p.p.')).toBeTruthy()
  expect(within(c).getByText(/Nenhum valor foi escolhido/)).toBeTruthy()
  // Os dois valores aparecem sem precisar expandir nada.
  expect(within(c).queryByRole('button')).toBeNull()
})

test('single_source: valor e o aviso de não verificado entre fontes', () => {
  render(<MetricTable payload={payloadOf(sevenStates())} />)
  const c = cell('ONEA3', 'price_to_book')
  expect(within(c).getByText('0,90')).toBeTruthy()
  expect(within(c).getByText('Não verificado entre fontes')).toBeTruthy()
})

test('incomparable: os valores e o motivo do servidor', () => {
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  const c = cell('TEST4', 'price_to_earnings')
  expect(within(c).getByText('12,0')).toBeTruthy()
  expect(within(c).getByText('9,8')).toBeTruthy()
  expect(within(c).getByText('Datas-base diferentes entre as fontes')).toBeTruthy()
  expect(within(c).getByText(/Data-base 30\/06\/2026/)).toBeTruthy()
})

test('missing mostra "Não disponível", nunca zero', () => {
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  const c = cell('TEST4', 'roe')
  expect(within(c).getByText('Não disponível')).toBeTruthy()
  expect(c.textContent).not.toMatch(/(^|[^0-9,.])0([^0-9,.]|$)|%|R\$/)
})

test('invalid não mostra o valor; not_applicable tem texto próprio', () => {
  render(<MetricTable payload={payloadOf(sevenStates())} />)
  expect(within(cell('ONEA3', 'quote_price')).getByText('Valor inválido: não exibido')).toBeTruthy()
  expect(cell('ONEA3', 'quote_price').textContent).not.toContain('5')
  expect(within(cell('ONEA3', 'roe')).getByText('Não se aplica a este ativo')).toBeTruthy()
})

test('sem aritmética: valores de 30 dígitos passam intactos, inclusive na diferença e no limite', () => {
  const raw = seedPayload()
  const ev = raw.evidence as { validations: { comparison: { delta_abs: string; limit: string } }[]; observations: { observation_id: string; value_decimal: string }[] }
  ev.observations.find((o) => o.observation_id === 'o3')!.value_decimal = '123456789012345678901234567890.55'
  ev.observations.find((o) => o.observation_id === 'o4')!.value_decimal = '123456789012345678901234567891.55'
  ev.validations[1].comparison.delta_abs = '1.00'
  ev.validations[1].comparison.limit = '999999999999999999999999999999.99'
  render(<MetricTable payload={payloadOf(raw)} />)
  const c = cell('DEMO3', 'dividend_yield')
  expect(within(c).getByText('123.456.789.012.345.678.901.234.567.890,55%')).toBeTruthy()
  expect(within(c).getByText('123.456.789.012.345.678.901.234.567.891,55%')).toBeTruthy()
  expect(within(c).getByText('999.999.999.999.999.999.999.999.999.999,99 p.p.')).toBeTruthy()
})

test('valor ilegível mostra "valor inválido", nunca NaN nem zero', () => {
  const raw = seedPayload()
  const ev = raw.evidence as { observations: { observation_id: string; value_decimal: string }[] }
  ev.observations.find((o) => o.observation_id === 'o3')!.value_decimal = '8,50%'
  render(<MetricTable payload={payloadOf(raw)} />)
  const c = cell('DEMO3', 'dividend_yield')
  expect(within(c).getByText('valor inválido')).toBeTruthy()
  expect(c.textContent).not.toMatch(/NaN/)
})

test('HTML hostil do servidor é texto literal, nunca elemento', () => {
  const raw = seedPayload()
  const ev = raw.evidence as { validations: { validation_id: string; reason: string }[]; observations: { source_id: string; observation_id: string }[] }
  ev.validations.find((v) => v.validation_id === 'v-pl')!.reason = '<script>alert(1)</script><img src=x onerror=alert(2)>'
  ev.observations.find((o) => o.observation_id === 'o5')!.source_id = '<b>evil</b>'
  raw.warnings = [{ code: '<script>x</script>', asset_id: '<img src=x onerror=alert(3)>', metric: '<svg onload=alert(4)>' }]
  const { container } = render(<MetricTable payload={payloadOf(raw)} />)
  expect(container.querySelector('script, img, svg[onload], b, [onerror]')).toBeNull()
  expect(container.innerHTML).not.toMatch(/<script|<img/i)
  expect(within(cell('TEST4', 'price_to_earnings')).getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy()
  expect(screen.getByText(/aviso do sistema \(código desconhecido\)/)).toBeTruthy()
})

test('link de fonte: https em domínio conhecido abre em nova aba; outros esquemas e hosts são descartados', () => {
  const raw = seedPayload()
  const ev = raw.evidence as { observations: { observation_id: string; source_url: string }[] }
  ev.observations.find((o) => o.observation_id === 'o1')!.source_url = 'javascript:alert(1)'
  ev.observations.find((o) => o.observation_id === 'o2')!.source_url = 'http://statusinvest.com.br/x'
  ev.observations.find((o) => o.observation_id === 'o3')!.source_url = 'https://evil.example/fundamentus.com.br'
  render(<MetricTable payload={payloadOf(raw)} />)
  const pvp = cell('DEMO3', 'price_to_book')
  expect(within(pvp).queryByRole('link')).toBeNull()
  expect(within(pvp).getByText('(link indisponível)')).toBeTruthy()
  const dy = cell('DEMO3', 'dividend_yield')
  const links = within(dy).getAllByRole('link')
  expect(links).toHaveLength(1) // só o do StatusInvest (o4)
  expect(links[0].getAttribute('href')).toBe('https://statusinvest.com.br/exemplo/DEMO3')
  expect(links[0].getAttribute('target')).toBe('_blank')
  expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
  expect(links[0].textContent).toContain('abre em nova aba')
  expect(document.querySelector('a[href^="javascript"], a[href^="http:"]')).toBeNull()
})

test('referência ausente na evidência vira "dado incompleto", sem inventar valor', () => {
  const raw = seedPayload()
  const ev = raw.evidence as { observations: { observation_id: string }[] }
  ev.observations = ev.observations.filter((o) => o.observation_id !== 'o4')
  render(<MetricTable payload={payloadOf(raw)} />)
  const c = screen.getByTestId('cell-v-dy')
  expect(within(c).getByText('Dado incompleto.')).toBeTruthy()
  expect(c.textContent).not.toMatch(/8,50|9,10/)
  // As outras células seguem íntegras.
  expect(within(cell('DEMO3', 'price_to_book')).getByText('1,50')).toBeTruthy()
})

test('um campo nunca herda a evidência de outro: observação de outro indicador ou ativo é recusada', () => {
  const raw = seedPayload()
  const v = (raw.evidence as { validations: { validation_id: string; observation_ids: string[] }[] }).validations
  v.find((x) => x.validation_id === 'v-dy')!.observation_ids = ['o3', 'o1'] // o1 é P/VP
  render(<MetricTable payload={payloadOf(raw)} />)
  expect(within(screen.getByTestId('cell-v-dy')).getByText('Dado incompleto.')).toBeTruthy()
  // E uma seção de P/VP que aponta para a validação de DY também é recusada.
  const raw2 = seedPayload()
  ;(raw2.sections as { validation_ids: string[] }[])[0].validation_ids = ['v-dy']
  render(<MetricTable payload={payloadOf(raw2)} />)
  expect(screen.getAllByText('Dado incompleto.').length).toBeGreaterThan(1)
})

test('avisos têm texto fixo por código, sem eco do texto do servidor', () => {
  const raw = seedPayload()
  raw.warnings = [
    { code: 'FIELD_NOT_IN_SNAPSHOT', message: 'ECO DO SERVIDOR', asset_id: 'DEMO3', metric: 'roe' },
    { code: 'PARTIAL_COVERAGE', message: 'ECO DO SERVIDOR' },
  ]
  render(<MetricTable payload={payloadOf(raw)} />)
  expect(screen.getByText('DEMO3, ROE: este indicador não consta no lote publicado.')).toBeTruthy()
  expect(screen.getByText('O lote não atualizou todos os ativos.')).toBeTruthy()
  expect(screen.queryByText(/ECO DO SERVIDOR/)).toBeNull()
})

test('a 360 px (sem matchMedia largo) a tabela vira cartões por ativo, sem <table>', () => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  })
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  expect(screen.queryByRole('table')).toBeNull()
  expect(within(cell('DEMO3', 'dividend_yield')).getByRole('heading', { level: 4, name: 'DEMO3' })).toBeTruthy()
})

test('a 768 px ou mais é uma tabela com cabeçalhos de coluna e de linha', () => {
  render(<MetricTable payload={payloadOf(seedPayload())} />)
  const tables = screen.getAllByRole('table')
  expect(tables).toHaveLength(2) // P/VP e Dividend yield
  expect(within(tables[1]).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Ativo', 'Estado', 'Valor e fonte'])
  expect(within(tables[1]).getByRole('rowheader', { name: 'DEMO3' })).toBeTruthy()
})
