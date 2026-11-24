import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'
import { chatConfig } from '@/features/chat/api'
import { DEMO3_UUID, ONEA3_UUID, TEST4_UUID, catalogBody } from '@/features/chat/fixtures'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

interface Call {
  url: string
  method: string
  body: Record<string, unknown> | null
  raw: string | null
}
type Handler = (call: Call, n: number) => Response | Promise<Response>

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let agentCalls: Call[] = []
let agentHandler: Handler
let catalogHandler: Handler
let uuidCounter = 0
const defaults = { ...chatConfig }
const METRICS = ['quote_price', 'price_to_book', 'price_to_earnings', 'dividend_yield', 'roe']

beforeEach(() => {
  fake.reset()
  fake.signIn('u1')
  fake.allow('u1')
  agentCalls = []
  uuidCounter = 0
  agentHandler = () => json(200, { status: 'completed', mode: 'deterministic' })
  catalogHandler = () => json(200, catalogBody())
  Object.assign(chatConfig, defaults, { processingPauseMs: 1 })
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const raw = typeof init?.body === 'string' ? init.body : null
      const call: Call = { url: String(url), method: init?.method ?? 'GET', body: raw ? JSON.parse(raw) : null, raw }
      if (call.url.endsWith('/functions/v1/agent')) {
        agentCalls.push(call)
        return agentHandler(call, agentCalls.length)
      }
      if (call.url.endsWith('/functions/v1/catalog')) return catalogHandler(call, 1)
      throw new Error(`rede inesperada: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.assign(chatConfig, defaults)
})

const open = async () => {
  renderApp('/carteira')
  await screen.findByRole('heading', { name: 'Carteira', level: 1 })
}
const select = () => screen.getByLabelText('Ação do sistema') as HTMLSelectElement
const optionValues = () => Array.from(select().options).map((o) => o.value).filter(Boolean)
const refreshButton = () => screen.getByRole('button', { name: /Atualizar carteira|Criando|Enviando|Aguardando/ })
const reads = () => fake.state.log.filter((l) => l.table === 'portfolio_items' && l.op === 'select').length
const writes = (op: string) => fake.state.log.filter((l) => l.table === 'portfolio_items' && l.op === op)
const waitList = async (text: string) => await screen.findByText(text)
const choose = (uuid: string) => fireEvent.change(select(), { target: { value: uuid } })
const clickAdd = () => fireEvent.click(screen.getByRole('button', { name: /Adicionar/ }))

// --- Carteira vazia ---

test('carteira vazia: convida a adicionar a primeira ação e o botão Atualizar fica desabilitado com explicação', async () => {
  await open()
  expect(await screen.findByText('Sua carteira está vazia')).toBeTruthy()
  expect(screen.getByText(/Escolha uma ação na lista acima/)).toBeTruthy()
  const button = refreshButton()
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByText('A carteira está vazia. Adicione uma ação para poder atualizar.')).toBeTruthy()
  fireEvent.click(button)
  await new Promise((r) => setTimeout(r, 20))
  expect(agentCalls).toHaveLength(0)
  expect(fake.state.tables.conversations).toHaveLength(0)
})

test('texto fixo: só ações acompanhadas, só o símbolo, sem quantidade nem valor', async () => {
  await open()
  expect(screen.getByText(/Só as ações acompanhadas pelo sistema podem ser adicionadas/)).toBeTruthy()
  expect(screen.getByText(/guarda apenas o símbolo de cada ação: nunca quantidade, preço nem valor/)).toBeTruthy()
  // sem campo de texto livre, quantidade, preço ou valor
  expect(document.querySelectorAll('input, textarea')).toHaveLength(0)
})

// --- Adicionar ---

test('adicionar: insere só user_id (da sessão) e asset_id (uuid), e relê a lista do banco', async () => {
  await open()
  await screen.findByText('Sua carteira está vazia')
  const before = reads()
  choose(TEST4_UUID)
  clickAdd()
  expect(await screen.findByText('TEST4 adicionada à carteira.')).toBeTruthy()
  const inserts = writes('insert')
  expect(inserts).toHaveLength(1)
  expect(inserts[0].payload).toEqual({ user_id: 'u1', asset_id: TEST4_UUID })
  expect(Object.keys(inserts[0].payload as object).sort()).toEqual(['asset_id', 'user_id'])
  expect(reads()).toBeGreaterThan(before) // releu depois de escrever
  const list = screen.getByRole('list')
  expect(within(list).getByText('TEST4')).toBeTruthy()
  expect(within(list).getByText('Teste S.A. (fictícia)')).toBeTruthy()
  expect(optionValues()).not.toContain(TEST4_UUID)
  // o foco volta a um alvo que existe (o seletor)
  await waitFor(() => expect(document.activeElement).toBe(select()))
})

test('sem atualização otimista: com a escrita segura a lista não muda; só depois da escrita e da releitura', async () => {
  await open()
  await screen.findByText('Sua carteira está vazia')
  let release: () => void = () => undefined
  fake.state.gate = new Promise<void>((resolve) => (release = resolve))
  choose(DEMO3_UUID)
  clickAdd()
  await screen.findByRole('button', { name: 'Adicionando...' })
  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.getByText('Sua carteira está vazia')).toBeTruthy()
  release()
  await waitFor(() => expect(within(screen.getByRole('list')).getByText('DEMO3')).toBeTruthy())
})

test('escrita que falha mostra erro, relê o banco e não adiciona nada à lista', async () => {
  await open()
  await screen.findByText('Sua carteira está vazia')
  const before = reads()
  fake.state.errors['portfolio_items.insert'] = 'rede'
  choose(DEMO3_UUID)
  clickAdd()
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível adicionar a ação')
  expect(reads()).toBeGreaterThan(before)
  expect(screen.queryByRole('list')).toBeNull()
})

test('duplicata (23505): mensagem amigável e a lista relida mostra o que está no banco', async () => {
  await open()
  await screen.findByText('Sua carteira está vazia')
  choose(TEST4_UUID)
  fake.addPortfolioItem(TEST4_UUID) // outra aba adicionou antes
  clickAdd()
  expect((await screen.findByRole('alert')).textContent).toContain('Esta ação já está na carteira')
  await waitFor(() => expect(within(screen.getByRole('list')).getByText('TEST4')).toBeTruthy())
  expect(fake.state.tables.portfolio_items).toHaveLength(1)
})

test('ativo inexistente (23503): mensagem própria, sem item novo', async () => {
  await open()
  await screen.findByText('Sua carteira está vazia')
  fake.state.errors['portfolio_items.insert'] = 'fk'
  fake.state.errorCodes['portfolio_items.insert'] = '23503'
  choose(TEST4_UUID)
  clickAdd()
  expect((await screen.findByRole('alert')).textContent).toContain('não consta mais entre as acompanhadas')
  expect(fake.state.tables.portfolio_items).toHaveLength(0)
})

test('Adicionar sem escolher uma ação mostra erro e não escreve', async () => {
  await open()
  await screen.findByText('Sua carteira está vazia')
  clickAdd()
  expect((await screen.findByRole('alert')).textContent).toContain('Escolha uma ação da lista')
  expect(writes('insert')).toHaveLength(0)
})

test('o seletor mostra só as ações do catálogo que NÃO estão na carteira (por uuid, lido do banco)', async () => {
  fake.addPortfolioItem(DEMO3_UUID)
  await open()
  await waitList('Demo S.A. (fictícia)')
  expect(optionValues()).toEqual([TEST4_UUID, ONEA3_UUID])
  expect(Array.from(select().options).map((o) => o.textContent)).not.toContain('DEMO3 — Demo S.A. (fictícia)')
  // carteira de outro usuário não interfere
  fake.addPortfolioItem(TEST4_UUID, 'u2')
  expect(optionValues()).toEqual([TEST4_UUID, ONEA3_UUID])
})

test('carteira cheia (20 ações): adicionar fica bloqueado com aviso visível e nada é escrito', async () => {
  const assets = Array.from({ length: 21 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return { id: `b0000000-0000-4000-8000-0000000000${n}`, asset_id: `ACAO${n}`, name: `Ação ${n} S.A.`, reference_url: null }
  })
  catalogHandler = () => json(200, { ...catalogBody(), assets })
  for (const a of assets.slice(0, 20)) fake.addPortfolioItem(a.id)
  await open()
  await screen.findByText('ACAO20')
  expect(screen.getByText(/já tem o máximo de 20 ações/)).toBeTruthy()
  choose(assets[20].id)
  clickAdd()
  await new Promise((r) => setTimeout(r, 20))
  expect(writes('insert')).toHaveLength(0)
  expect(screen.getByRole('button', { name: /Adicionar/ }).getAttribute('aria-disabled')).toBe('true')
})

// --- Remover ---

test('remover: cancelar não remove; confirmar remove e relê; o foco vai para um alvo que existe', async () => {
  fake.addPortfolioItem(DEMO3_UUID)
  fake.addPortfolioItem(TEST4_UUID)
  await open()
  await screen.findByText('TEST4')
  fireEvent.click(screen.getByRole('button', { name: 'Remover DEMO3 da carteira' }))
  const dialog = await screen.findByRole('alertdialog')
  expect(within(dialog).getByText(/DEMO3 sai da carteira/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(writes('delete')).toHaveLength(0)
  expect(fake.state.tables.portfolio_items).toHaveLength(2)

  fireEvent.click(screen.getByRole('button', { name: 'Remover DEMO3 da carteira' }))
  const again = await screen.findByRole('alertdialog')
  const before = reads()
  fireEvent.click(within(again).getByRole('button', { name: 'Remover da carteira' }))
  expect(await screen.findByText('DEMO3 removida da carteira.')).toBeTruthy()
  expect(writes('delete')).toHaveLength(1)
  expect(reads()).toBeGreaterThan(before)
  expect(fake.state.tables.portfolio_items.map((r) => r.asset_id)).toEqual([TEST4_UUID])
  expect(within(screen.getByRole('list')).queryByText('DEMO3')).toBeNull()
  expect(optionValues()).toContain(DEMO3_UUID) // voltou ao seletor
  await waitFor(() => expect(document.activeElement?.id).toMatch(/^remover-/))
  expect(document.activeElement?.isConnected).toBe(true)
})

test('Esc fecha o diálogo de remoção sem remover', async () => {
  fake.addPortfolioItem(DEMO3_UUID)
  await open()
  await screen.findByText('DEMO3')
  fireEvent.click(screen.getByRole('button', { name: 'Remover DEMO3 da carteira' }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(writes('delete')).toHaveLength(0)
})

test('remoção que falha mostra erro, relê e mantém o item', async () => {
  fake.addPortfolioItem(DEMO3_UUID)
  await open()
  await screen.findByText('DEMO3')
  fake.state.errors['portfolio_items.delete'] = 'rede'
  fireEvent.click(screen.getByRole('button', { name: 'Remover DEMO3 da carteira' }))
  fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remover da carteira' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível remover a ação')
  expect(within(screen.getByRole('list')).getByText('DEMO3')).toBeTruthy()
})

// --- Leitura e catálogo ---

test('erro de leitura da carteira: mostra erro, nunca lista vazia nem convite', async () => {
  fake.state.errors['portfolio_items.select'] = 'rede'
  await open()
  expect((await screen.findByText('Não foi possível carregar a carteira'))).toBeTruthy()
  expect(screen.queryByText('Sua carteira está vazia')).toBeNull()
  expect(screen.queryByRole('list')).toBeNull()
})

test('uuid fora do catálogo: "Ativo não encontrado no catálogo", com opção de remover; fica fora da atualização', async () => {
  fake.addPortfolioItem(DEMO3_UUID)
  fake.addPortfolioItem('99999999-9999-4999-8999-999999999999')
  await open()
  expect(await screen.findByText('Ativo não encontrado no catálogo')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Remover ativo não encontrado da carteira' })).toBeTruthy()
  expect(screen.getByText(/1 ação da carteira não consta no catálogo e ficará de fora/)).toBeTruthy()
  fireEvent.click(refreshButton())
  await waitFor(() => expect(agentCalls).toHaveLength(1))
  expect((agentCalls[0].body!.selection as { asset_ids: string[] }).asset_ids).toEqual(['DEMO3'])
})

test('catálogo indisponível: a carteira aparece sem símbolo, dá para remover, e adicionar/atualizar ficam bloqueados', async () => {
  fake.addPortfolioItem(DEMO3_UUID)
  catalogHandler = () => json(500, { error: { code: 'INTERNAL_ERROR' } })
  await open()
  expect(await screen.findByText('Não foi possível carregar as ações do sistema')).toBeTruthy()
  expect(await screen.findByText('Símbolo indisponível: catálogo não carregado')).toBeTruthy()
  expect(refreshButton().getAttribute('aria-disabled')).toBe('true')
  expect(screen.getByText(/O catálogo de ações não está disponível/)).toBeTruthy()
  clickAdd()
  expect(writes('insert')).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'Remover ativo não encontrado da carteira' })).toBeTruthy()
})

test('catálogo sem o identificador dos ativos (backend antigo): erro claro, sem tentar o insert com símbolo', async () => {
  const old = catalogBody() as { assets: Record<string, unknown>[] }
  old.assets = old.assets.map(({ id: _id, ...rest }) => rest)
  catalogHandler = () => json(200, old)
  fake.addPortfolioItem(DEMO3_UUID)
  await open()
  expect(await screen.findByText('Catálogo sem identificador dos ativos')).toBeTruthy()
  expect(optionValues()).toEqual([])
  clickAdd()
  fireEvent.change(select(), { target: { value: 'DEMO3' } })
  clickAdd()
  await new Promise((r) => setTimeout(r, 20))
  expect(writes('insert')).toHaveLength(0)
  expect(refreshButton().getAttribute('aria-disabled')).toBe('true')
})

// --- Atualizar carteira ---

async function withTwoItems() {
  fake.addPortfolioItem(DEMO3_UUID)
  fake.addPortfolioItem(TEST4_UUID)
  await open()
  await screen.findByText('TEST4')
  await waitFor(() => expect(refreshButton().getAttribute('aria-disabled')).toBeNull())
}

test('Atualizar carteira: nova conversa, POST /agent com selection (todas as ações e as 5 métricas) e SEM message; depois abre a conversa', async () => {
  await withTwoItems()
  fireEvent.click(refreshButton())
  // chegou na tela da conversa (lê as mensagens do banco)
  expect(await screen.findByLabelText('Sua pergunta')).toBeTruthy()
  expect(agentCalls).toHaveLength(1)
  const call = agentCalls[0]
  expect(call.method).toBe('POST')
  expect(call.body).not.toBeNull()
  expect(Object.keys(call.body!).sort()).toEqual(['conversation_id', 'request_id', 'selection'])
  expect('message' in call.body!).toBe(false)
  expect(call.raw).not.toContain('"message"')
  expect(call.body!.selection).toEqual({ asset_ids: ['DEMO3', 'TEST4'], metrics: METRICS })
  const created = fake.state.tables.conversations
  expect(created).toHaveLength(1)
  expect(call.body!.conversation_id).toBe(created[0].id)
  expect(created[0].user_id).toBe('u1')
  expect(String(created[0].title)).toMatch(/^Carteira — \d{2}\/\d{2}\/\d{4}$/)
  expect(String(created[0].title).length).toBeLessThanOrEqual(200)
  expect(call.body!.request_id).toBe('00000000-0000-4000-8000-000000000001')
})

test('falha de rede: o reenvio reutiliza a conversa e o request_id; depois do sucesso a próxima atualização usa id novo', async () => {
  await withTwoItems()
  agentHandler = (_c, n) => (n === 1 ? json(503, { error: { code: 'SERVICE_UNAVAILABLE' } }) : json(200, { status: 'completed', mode: 'deterministic' }))
  fireEvent.click(refreshButton())
  expect((await screen.findByRole('alert')).textContent).toContain('Serviço indisponível')
  expect(screen.getByRole('link', { name: 'Abrir a conversa' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByLabelText('Sua pergunta')).toBeTruthy()
  expect(agentCalls).toHaveLength(2)
  expect(agentCalls[1].body!.request_id).toBe(agentCalls[0].body!.request_id)
  expect(agentCalls[1].body!.conversation_id).toBe(agentCalls[0].body!.conversation_id)
  expect(fake.state.tables.conversations).toHaveLength(1) // sem conversa órfã a mais
})

test('202 esgotado vira "Ainda processando", sem trocar o request_id', async () => {
  await withTwoItems()
  agentHandler = () => json(202, { status: 'processing' })
  fireEvent.click(refreshButton())
  expect((await screen.findByRole('alert')).textContent).toContain('Ainda processando')
  expect(agentCalls).toHaveLength(chatConfig.processingMaxAttempts)
  expect(new Set(agentCalls.map((c) => c.body!.request_id)).size).toBe(1)
})

test('falha ao criar a conversa: erro claro e nada é enviado ao /agent', async () => {
  await withTwoItems()
  fake.state.errors['conversations.insert'] = 'rede'
  fireEvent.click(refreshButton())
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível criar a conversa')
  expect(agentCalls).toHaveLength(0)
  // nova tentativa depois que o banco volta
  delete fake.state.errors['conversations.insert']
  agentHandler = () => json(200, { status: 'completed', mode: 'deterministic' })
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByLabelText('Sua pergunta')).toBeTruthy()
  expect(agentCalls).toHaveLength(1)
})

test('422 pede para remover a ação não reconhecida (sem seletor manual); 401 encerra a sessão; 409 troca o request_id e mantém a conversa', async () => {
  await withTwoItems()
  agentHandler = () => json(422, { error: { code: 'UNKNOWN_ASSET' } })
  fireEvent.click(refreshButton())
  expect((await screen.findByRole('alert')).textContent).toContain('Remova-a da carteira')
  expect(screen.queryByText(/seletor manual/)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()

  agentHandler = (_c, n) => (n === 2 ? json(409, { error: { code: 'REQUEST_CONFLICT' } }) : json(401, { error: { code: 'UNAUTHENTICATED' } }))
  fireEvent.click(refreshButton())
  await waitFor(() => expect(agentCalls).toHaveLength(2))
  expect(agentCalls[1].body!.conversation_id).toBe(agentCalls[0].body!.conversation_id)
  await screen.findByText('Pedido em conflito')
  fireEvent.click(refreshButton())
  await waitFor(() => expect(fake.client.auth.signOut).toHaveBeenCalled())
  expect(agentCalls[2].body!.request_id).not.toBe(agentCalls[1].body!.request_id)
})

test('o botão não dispara duas vezes enquanto envia', async () => {
  await withTwoItems()
  let release: () => void = () => undefined
  agentHandler = async () => {
    await new Promise<void>((r) => (release = r))
    return json(200, { status: 'completed', mode: 'deterministic' })
  }
  fireEvent.click(refreshButton())
  await waitFor(() => expect(agentCalls).toHaveLength(1))
  fireEvent.click(refreshButton())
  fireEvent.click(refreshButton())
  release()
  await screen.findByLabelText('Sua pergunta')
  expect(agentCalls).toHaveLength(1)
  expect(fake.state.tables.conversations).toHaveLength(1)
})

// --- A carteira nunca vai ao LLM ---

test('numa conversa com carteira não vazia, a pergunta digitada vai com `message` e SEM nada da carteira', async () => {
  fake.addPortfolioItem(TEST4_UUID)
  fake.addPortfolioItem(ONEA3_UUID)
  const conv = fake.addConversation('Conversa')
  renderApp(`/conversas/${conv.id}`)
  fireEvent.change(await screen.findByLabelText('Sua pergunta'), { target: { value: 'Qual o P/L de DEMO3?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }))
  await waitFor(() => expect(agentCalls).toHaveLength(1))
  const call = agentCalls[0]
  expect(call.body!.message).toBe('Qual o P/L de DEMO3?')
  expect('selection' in call.body!).toBe(false)
  for (const secret of [TEST4_UUID, ONEA3_UUID, 'TEST4', 'ONEA3', 'portfolio', 'carteira']) {
    expect(call.raw).not.toContain(secret)
  }
  // e a carteira nem foi lida pela tela do chat
  expect(fake.state.log.filter((l) => l.table === 'portfolio_items')).toHaveLength(0)
})

// --- Verificação estrutural ---

const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const isTest = (path: string) => /\.test\.tsx?$/.test(path) || path.includes('/src/test/')

test('estrutura: nenhum arquivo fora da carteira importa features/portfolio, exceto a rota', () => {
  const importers = Object.entries(sources)
    .filter(([path]) => !path.startsWith('/src/features/portfolio/') && !isTest(path))
    .filter(([, text]) => /from\s+['"][^'"]*portfolio[^'"]*['"]/.test(text))
    .map(([path]) => path)
  expect(importers).toEqual(['/src/routes/AppRoutes.tsx'])
  // o fluxo de `message` (chat, classificador, conversas) não importa a carteira
  const flow = Object.entries(sources).filter(([path]) => /\/src\/features\/(chat|conversations)\//.test(path) && !isTest(path))
  expect(flow.length).toBeGreaterThan(5)
  for (const [path, text] of flow) {
    expect(text, path).not.toMatch(/portfolio/i)
  }
})

test('estrutura: a carteira chama /agent uma única vez, com selection e message nulo; o chat não lê portfolio_items', () => {
  const own = Object.entries(sources).filter(([path]) => path.startsWith('/src/features/portfolio/') && !isTest(path))
  const calls = own.flatMap(([path, text]) => (text.match(/postAgent\w*\(/g) ?? []).map(() => path))
  expect(calls).toEqual(['/src/features/portfolio/hooks.ts'])
  const hooks = sources['/src/features/portfolio/hooks.ts']
  expect(hooks).toMatch(/\{ message: null, selection: \{ asset_ids: symbols, metrics \} \}/)
  const chatText = Object.entries(sources)
    .filter(([path]) => path.startsWith('/src/features/chat/') && !isTest(path))
    .map(([, text]) => text)
    .join('\n')
  expect(chatText).not.toContain('portfolio_items')
})

test('estrutura: o insert da carteira leva só user_id e asset_id', () => {
  const api = sources['/src/features/portfolio/api.ts']
  expect(api).toContain('.insert({ user_id: userId, asset_id: assetUuid })')
  expect(api.match(/\.insert\(/g)).toHaveLength(1)
})
