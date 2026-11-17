import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'
import { catalogBody, defaultSnapshot } from '@/features/chat/fixtures'
import { SOURCES } from './sources'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let catalogCalls = 0
let catalogHandler: () => Response | Promise<Response>

beforeEach(() => {
  fake.reset()
  fake.signIn('u1')
  fake.allow('u1')
  catalogCalls = 0
  catalogHandler = () => json(200, catalogBody())
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/functions/v1/catalog')) {
        catalogCalls += 1
        return catalogHandler()
      }
      throw new Error(`rede inesperada: ${url}`)
    }),
  )
})

const COUNTS = { verified: 5, divergent: 4, single_source: 3, incomparable: 2, missing: 1, not_applicable: 6, invalid: 7 }

function snapshot(extra: Record<string, unknown> = {}) {
  return { ...defaultSnapshot(), ...extra }
}

async function open() {
  renderApp('/dados')
  await screen.findByRole('heading', { name: 'Dados', level: 1 })
}

test('painel com snapshot: data em Brasília, selo de atualização, X de Y, 7 contagens e falhas', async () => {
  catalogHandler = () =>
    json(200, catalogBody(snapshot({ status_counts: COUNTS, failures: [{ asset_id: 'DEMO3', source_id: 'statusinvest', reason: 'Tempo esgotado' }] })))
  await open()
  const lote = (await screen.findByRole('heading', { name: 'Último lote de dados' })).closest('section') as HTMLElement
  // 2026-09-18T20:05Z = 17:05 em Brasília (UTC-3)
  expect(lote.textContent).toContain('18/09/2026')
  expect(lote.textContent).toContain('17:05')
  expect(lote.textContent).toContain('horário de Brasília')
  expect(within(lote).getByRole('img', { name: 'Estado da atualização: Atualizado' })).toBeTruthy()
  expect(lote.textContent).toContain('11 de 12 ativos atualizados')
  expect(lote.textContent).toContain('seed-1')

  const counts = (await screen.findByRole('heading', { name: 'Campos por estado de validação' })).closest('section') as HTMLElement
  const rows = within(counts).getAllByRole('listitem')
  expect(rows).toHaveLength(7)
  const expected: [string, string][] = [
    ['Conferido', '5 campos'],
    ['Divergente', '4 campos'],
    ['Fonte única', '3 campos'],
    ['Não comparável', '2 campos'],
    ['Sem dado', '1 campo'],
    ['Não se aplica', '6 campos'],
    ['Inválido', '7 campos'],
  ]
  expected.forEach(([label, text], i) => {
    expect(within(rows[i]).getByRole('img', { name: `Estado da validação: ${label}` })).toBeTruthy()
    expect(rows[i].textContent).toContain(text)
  })

  const falhas = (await screen.findByRole('heading', { name: 'Falhas de coleta' })).closest('section') as HTMLElement
  expect(falhas.textContent).toContain('DEMO3')
  expect(falhas.textContent).toContain('Demo S.A. (fictícia)')
  expect(falhas.textContent).toContain('StatusInvest')
  expect(falhas.textContent).toContain('Tempo esgotado')
  expect(falhas.textContent).not.toContain('Nenhuma falha registrada')
})

test('sem falhas: "Nenhuma falha registrada neste lote"', async () => {
  await open()
  expect(await screen.findByText('Nenhuma falha registrada neste lote.')).toBeTruthy()
})

test('falhas ausentes no catálogo não viram lista vazia nem "nenhuma falha"', async () => {
  const s = snapshot()
  delete s.failures
  catalogHandler = () => json(200, catalogBody(s))
  await open()
  expect(await screen.findByText('A lista de falhas não está disponível neste lote.')).toBeTruthy()
  expect(screen.queryByText(/Nenhuma falha registrada/)).toBeNull()
})

test('sem snapshot: "Ainda não há dados coletados", sem zeros fingindo dados', async () => {
  catalogHandler = () => json(200, catalogBody(null))
  await open()
  expect(await screen.findByRole('heading', { name: 'Ainda não há dados coletados' })).toBeTruthy()
  expect(screen.queryByText(/ativos atualizados/)).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Campos por estado de validação' })).toBeNull()
  expect(screen.queryByText(/campos?$/)).toBeNull()
  // as fontes e a exportação continuam na tela
  expect(screen.getByRole('heading', { name: 'Fontes e permissão de coleta' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Exportar meus dados' })).toBeTruthy()
})

test('stale: selo "Desatualizado" e aviso visível', async () => {
  catalogHandler = () => json(200, catalogBody(snapshot({ freshness: 'stale' })))
  await open()
  expect(await screen.findByRole('img', { name: 'Estado da atualização: Desatualizado' })).toBeTruthy()
  expect(screen.getByText('Dados desatualizados: confira a data antes de usar.')).toBeTruthy()
})

test('expired: selo "Vencido" e aviso de não usar como atual', async () => {
  catalogHandler = () => json(200, catalogBody(snapshot({ freshness: 'expired' })))
  await open()
  expect(await screen.findByRole('img', { name: 'Estado da atualização: Vencido' })).toBeTruthy()
  expect(screen.getByText('Dados vencidos: não use como atuais. Aguarde uma nova coleta.')).toBeTruthy()
})

test('fresh não mostra aviso de atraso', async () => {
  await open()
  await screen.findByRole('img', { name: 'Estado da atualização: Atualizado' })
  expect(screen.queryByText(/Dados desatualizados|Dados vencidos|data-base do lote/)).toBeNull()
})

test('estado de atualização desconhecido (unknown_reference_date): selo e aviso', async () => {
  catalogHandler = () => json(200, catalogBody(snapshot({ freshness: 'unknown_reference_date' })))
  await open()
  expect(await screen.findByRole('img', { name: 'Estado da atualização: Data-base desconhecida' })).toBeTruthy()
  expect(screen.getByText(/A data-base do lote não é conhecida/)).toBeTruthy()
})

test('frescor fora do contrato: erro, não um selo inventado', async () => {
  catalogHandler = () => json(200, catalogBody(snapshot({ freshness: 'novo_estado' })))
  await open()
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText(/ativos atualizados/)).toBeNull()
})

test('universe_version null: "não informada"', async () => {
  catalogHandler = () => json(200, { ...catalogBody(), universe_version: null })
  await open()
  expect(await screen.findByText('Versão da lista de ações: não informada.')).toBeTruthy()
})

test('estado novo em status_counts é tolerado; chave que falta aparece como "não informado"', async () => {
  const { missing: _omit, ...rest } = COUNTS
  catalogHandler = () => json(200, catalogBody(snapshot({ status_counts: { ...rest, estado_novo: 9 } })))
  await open()
  const counts = (await screen.findByRole('heading', { name: 'Campos por estado de validação' })).closest('section') as HTMLElement
  expect(counts.textContent).toContain('Estado não reconhecido: estado_novo')
  expect(counts.textContent).toContain('9 campos')
  const semDado = within(counts).getByRole('img', { name: 'Estado da validação: Sem dado' }).closest('li') as HTMLElement
  expect(semDado.textContent).toContain('não informado')
  expect(counts.textContent).not.toContain('0 campos')
})

test('status_counts ilegível: aviso, não zeros', async () => {
  catalogHandler = () => json(200, catalogBody(snapshot({ status_counts: { verified: '3' } })))
  await open()
  expect(await screen.findByText('A contagem de campos por estado não está disponível neste lote.')).toBeTruthy()
})

test('motivo da falha é texto: <script> não vira elemento', async () => {
  const reason = '<script>alert(1)</script><img src=x onerror=alert(2)>'
  catalogHandler = () =>
    json(200, catalogBody(snapshot({ failures: [{ asset_id: 'TEST4', source_id: 'fundamentus<b>', reason }] })))
  await open()
  const falhas = (await screen.findByRole('heading', { name: 'Falhas de coleta' })).closest('section') as HTMLElement
  expect(falhas.textContent).toContain(reason)
  expect(falhas.querySelector('script')).toBeNull()
  expect(falhas.querySelector('img')).toBeNull()
  expect(falhas.querySelector('b')).toBeNull()
})

test('catálogo com erro: alerta e "Tentar de novo" que busca outra vez', async () => {
  let first = true
  catalogHandler = () => {
    if (first) {
      first = false
      return json(500, { error: { code: 'INTERNAL_ERROR' } })
    }
    return json(200, catalogBody())
  }
  await open()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Não foi possível carregar o estado dos dados')
  expect(screen.queryByText(/ativos atualizados/)).toBeNull()
  // a tela não some: fontes e exportação seguem disponíveis
  expect(screen.getByRole('button', { name: 'Exportar meus dados' })).toBeTruthy()
  fireEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByText('11 de 12 ativos atualizados')).toBeTruthy()
  expect(catalogCalls).toBe(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('rede que falha no catálogo é erro, não tela vazia', async () => {
  catalogHandler = () => {
    throw new Error('offline')
  }
  await open()
  expect((await screen.findByRole('alert')).textContent).toContain('Nada foi exibido como dado')
})

test('carregando: mostra o estado de carregamento', async () => {
  let release: (r: Response) => void = () => undefined
  catalogHandler = () => new Promise<Response>((resolve) => (release = resolve))
  await open()
  expect(await screen.findByText('Carregando o estado dos dados...')).toBeTruthy()
  release(json(200, catalogBody()))
  expect(await screen.findByText('11 de 12 ativos atualizados')).toBeTruthy()
})

test('lista de fontes mostra o estado de permissão de cada uma, com texto', async () => {
  await open()
  const section = screen.getByRole('heading', { name: 'Fontes e permissão de coleta' }).closest('section') as HTMLElement
  const items = within(section).getAllByRole('listitem')
  expect(items).toHaveLength(SOURCES.length)
  for (const source of SOURCES) {
    const item = items.find((li) => li.textContent?.includes(source.name)) as HTMLElement
    expect(item).toBeTruthy()
    const label = source.permission === 'permitida' ? 'Permitida' : source.permission === 'indefinida' ? 'Indefinida' : 'Proibida'
    expect(within(item).getByRole('img', { name: `Permissão de coleta: ${label}` })).toBeTruthy()
    expect(item.textContent).toContain('Coleta habilitada')
    expect(item.textContent).toContain('14/11/2026')
  }
  expect(within(section).getAllByRole('img', { name: 'Permissão de coleta: Indefinida' })).toHaveLength(2)
  expect(within(section).getAllByRole('img', { name: 'Permissão de coleta: Permitida' })).toHaveLength(1)
  expect(section.textContent).toContain('por conta e risco próprios')
})

test('usuário negado em /dados vai a /entrar e nada é lido', async () => {
  fake.signIn('u2') // sem linha em allowed_users
  renderApp('/dados')
  expect((await screen.findByRole('alert')).textContent).toContain('Acesso não autorizado')
  expect(screen.queryByRole('heading', { name: 'Dados', level: 1 })).toBeNull()
  expect(catalogCalls).toBe(0)
  expect(fake.state.log.filter((l) => ['conversations', 'messages', 'portfolio_items'].includes(l.table))).toEqual([])
})

test('usuário revogado enquanto está em /dados cai em /entrar ao navegar', async () => {
  fake.addConversation('Antiga')
  await open()
  fake.revoke('u1')
  fireEvent.click(screen.getAllByRole('link', { name: 'Conversas' })[0])
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Acesso não autorizado'))
  expect(screen.queryByRole('heading', { name: 'Dados', level: 1 })).toBeNull()
})
