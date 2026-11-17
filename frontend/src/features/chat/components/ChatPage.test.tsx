import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'
import { chatConfig } from '../api'
import { catalogBody, seedPayload } from '../fixtures'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

type Handler = (call: Call, n: number, signal: AbortSignal | null | undefined) => Response | Promise<Response>

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

let agentCalls: Call[] = []
let catalogCalls: Call[] = []
let agentHandler: Handler
let catalogHandler: Handler
let uuidCounter = 0
let conversationId = ''
const defaults = { ...chatConfig }

// Simula o que a função grava: mensagem do usuário e a resposta do assistente.
function serverWritesTurn(text: string | null) {
  const rows = fake.state.tables.messages.filter((m) => m.conversation_id === conversationId)
  let n = rows.length
  if (text !== null) fake.addMessage(conversationId, { role: 'user', sequence_no: ++n, content: text })
  fake.addMessage(conversationId, { role: 'assistant', sequence_no: ++n, content: 'Resposta montada sem IA', payload: seedPayload() })
}

const completed = () => json(200, { status: 'completed', mode: 'deterministic' })

beforeEach(() => {
  fake.reset()
  fake.signIn('u1')
  fake.allow('u1')
  conversationId = fake.addConversation('Conversa de teste').id as string
  agentCalls = []
  catalogCalls = []
  uuidCounter = 0
  agentHandler = () => completed()
  catalogHandler = () => json(200, catalogBody())
  Object.assign(chatConfig, defaults, { processingPauseMs: 1 })
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        url: String(url),
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      }
      if (call.url.endsWith('/functions/v1/agent')) {
        agentCalls.push(call)
        return agentHandler(call, agentCalls.length, init?.signal)
      }
      if (call.url.endsWith('/functions/v1/catalog')) {
        catalogCalls.push(call)
        return catalogHandler(call, catalogCalls.length, init?.signal)
      }
      throw new Error(`rede inesperada: ${url}`)
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.assign(chatConfig, defaults)
})

const open = async (path = `/conversas/${conversationId}`) => {
  renderApp(path)
  await screen.findByLabelText('Sua pergunta')
}
const type = (text: string) => fireEvent.change(screen.getByLabelText('Sua pergunta'), { target: { value: text } })
const sendButton = () => screen.getByRole('button', { name: /Enviar pergunta|Enviando/ })
const clickSend = () => fireEvent.click(sendButton())
const messageItems = () => screen.queryAllByRole('listitem').filter((li) => li.id.startsWith('msg-'))

// --- Leitura ---

test('mostra as mensagens do banco em ordem cronológica, o texto do usuário como texto e a tabela do assistente', async () => {
  fake.addMessage(conversationId, { role: 'assistant', sequence_no: 2, content: 'Resposta', payload: seedPayload() })
  fake.addMessage(conversationId, { role: 'user', sequence_no: 1, content: 'dividend yield de DEMO3 <img src=x onerror=alert(1)>' })
  await open()
  const items = await waitFor(() => {
    const found = messageItems()
    expect(found).toHaveLength(2)
    return found
  })
  expect(items[0].textContent).toContain('<img src=x onerror=alert(1)>')
  expect(items[0].querySelector('img')).toBeNull()
  expect(within(items[1]).getByText('11 de 12 ativos atualizados')).toBeTruthy()
  expect(within(items[1]).getByText('8,50%')).toBeTruthy()
  // Só leu o banco: a tabela não chamou /agent.
  expect(agentCalls).toHaveLength(0)
})

test('conversa vazia mostra o estado vazio', async () => {
  await open()
  expect(await screen.findByText('Nenhuma mensagem ainda')).toBeTruthy()
})

test('mensagens paginadas por cursor: 20 mais recentes e "Carregar mensagens anteriores"', async () => {
  for (let n = 1; n <= 45; n++) {
    fake.addMessage(conversationId, { role: n % 2 ? 'user' : 'assistant', sequence_no: n, content: `mensagem ${n}`, payload: null })
  }
  await open()
  await waitFor(() => expect(messageItems()).toHaveLength(20))
  expect(screen.getByText('mensagem 45')).toBeTruthy()
  expect(screen.getByText('mensagem 26')).toBeTruthy()
  expect(screen.queryByText('mensagem 25')).toBeNull()
  const messagesReads = () => fake.state.log.filter((l) => l.table === 'messages' && l.op === 'select').length
  expect(messagesReads()).toBe(1)

  fireEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }))
  await waitFor(() => expect(messageItems()).toHaveLength(40))
  expect(screen.getByText('mensagem 6')).toBeTruthy()
  expect(messageItems()[0].textContent).toContain('mensagem 6')
  expect(messageItems()[39].textContent).toContain('mensagem 45')

  fireEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }))
  await waitFor(() => expect(messageItems()).toHaveLength(45))
  expect(screen.queryByRole('button', { name: 'Carregar mensagens anteriores' })).toBeNull()
  expect(messageItems()[0].textContent).toContain('mensagem 1')
})

test('exatamente uma página cheia não mostra "carregar anteriores"', async () => {
  for (let n = 1; n <= 20; n++) fake.addMessage(conversationId, { role: 'user', sequence_no: n, content: `m${n}` })
  await open()
  await waitFor(() => expect(messageItems()).toHaveLength(20))
  expect(screen.queryByRole('button', { name: 'Carregar mensagens anteriores' })).toBeNull()
})

test('conversa de outro dono e conversa inexistente mostram "não encontrada", sem mensagens', async () => {
  const other = fake.addConversation('De outra pessoa', 'u2').id as string
  fake.addMessage(other, { role: 'user', sequence_no: 1, content: 'segredo de u2' }, 'u2')
  renderApp(`/conversas/${other}`)
  expect((await screen.findByRole('alert')).textContent).toContain('Conversa não encontrada')
  expect(screen.queryByText('segredo de u2')).toBeNull()
  expect(screen.queryByLabelText('Sua pergunta')).toBeNull()
  expect(fake.state.log.filter((l) => l.table === 'messages')).toHaveLength(0)
})

test('conversa inexistente mostra "não encontrada"', async () => {
  renderApp('/conversas/nao-existe')
  expect((await screen.findByRole('alert')).textContent).toContain('Conversa não encontrada')
})

test('erro de leitura das mensagens mostra erro, não lista vazia', async () => {
  fake.state.errors['messages.select'] = 'rede'
  await open()
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as mensagens')
  expect(screen.queryByText('Nenhuma mensagem ainda')).toBeNull()
})

test('resposta com formato de payload não reconhecido não é exibida como dado', async () => {
  fake.addMessage(conversationId, { role: 'assistant', sequence_no: 1, content: 'texto', payload: { content_version: 2, sections: [] } })
  await open()
  expect(await screen.findByText(/formato não reconhecido/)).toBeTruthy()
  expect(screen.queryByText('Dados do lote')).toBeNull()
})

// --- Envio ---

test('envia para /agent com Bearer do usuário e apikey; o corpo não tem user_id, e-mail nem carteira', async () => {
  await open()
  type('  dividend yield de DEMO3  ')
  clickSend()
  await screen.findByText('Resposta recebida.')
  expect(agentCalls).toHaveLength(1)
  const call = agentCalls[0]
  expect(call.url).toBe('http://127.0.0.1:54321/functions/v1/agent')
  expect(call.method).toBe('POST')
  expect(call.headers.Authorization).toBe('Bearer token-u1')
  expect(call.headers.apikey).toBe('chave-nao-configurada')
  expect(call.body).toEqual({
    request_id: '00000000-0000-4000-8000-000000000001',
    conversation_id: conversationId,
    message: 'dividend yield de DEMO3',
  })
  expect(JSON.stringify(call.body)).not.toMatch(/user_id|email|carteira|portfolio|u1/)
  // A caixa é limpa só depois do sucesso.
  expect((screen.getByLabelText('Sua pergunta') as HTMLTextAreaElement).value).toBe('')
})

test('sem atualização otimista: a mensagem do usuário só aparece depois da releitura do banco', async () => {
  await open()
  await screen.findByText('Nenhuma mensagem ainda')
  agentHandler = () => {
    serverWritesTurn('qual o P/VP de DEMO3')
    return completed()
  }
  type('qual o P/VP de DEMO3')
  let release: () => void = () => {}
  fake.state.messagesGate = new Promise<void>((resolve) => (release = resolve))
  clickSend()
  await waitFor(() => expect(agentCalls).toHaveLength(1))
  // Resposta do /agent já chegou, a releitura está segurada: nada de mensagem na lista.
  await new Promise((r) => setTimeout(r, 30))
  expect(messageItems()).toHaveLength(0)
  expect(screen.getByText('Enviando pergunta...')).toBeTruthy()
  expect(sendButton().getAttribute('aria-disabled')).toBe('true')
  fake.state.messagesGate = null
  release()
  await waitFor(() => expect(messageItems()).toHaveLength(2))
  expect(messageItems()[0].textContent).toContain('qual o P/VP de DEMO3')
  expect(await screen.findByText('Resposta recebida.')).toBeTruthy()
})

test('falha do envio não adiciona mensagem e a caixa mantém o texto', async () => {
  await open()
  await screen.findByText('Nenhuma mensagem ainda')
  agentHandler = () => json(500, { error: { code: 'INTERNAL_ERROR', message: 'detalhe interno secreto' } })
  type('minha pergunta')
  clickSend()
  const alert = await screen.findByText('Erro no servidor')
  expect(alert.closest('[role="alert"]')!.textContent).not.toContain('detalhe interno secreto')
  expect(messageItems()).toHaveLength(0)
  expect(screen.getByText('Nenhuma mensagem ainda')).toBeTruthy()
  expect((screen.getByLabelText('Sua pergunta') as HTMLTextAreaElement).value).toBe('minha pergunta')
})

test('não permite envio duplo enquanto envia', async () => {
  await open()
  let release: (r: Response) => void = () => {}
  agentHandler = () => new Promise<Response>((resolve) => (release = resolve))
  type('pergunta')
  clickSend()
  clickSend()
  fireEvent.submit(screen.getByLabelText('Sua pergunta').closest('form')!)
  await waitFor(() => expect(agentCalls).toHaveLength(1))
  await act(async () => release(completed()))
  await screen.findByText('Resposta recebida.')
  expect(agentCalls).toHaveLength(1)
})

test('request_id: reutilizado ao reenviar a MESMA pergunta depois de falha; novo se a pergunta muda; novo depois de sucesso', async () => {
  await open()
  agentHandler = (_c, n) => (n <= 2 ? json(500, { error: { code: 'INTERNAL_ERROR' } }) : completed())
  type('pergunta A')
  clickSend()
  await screen.findByText('Erro no servidor')
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await screen.findByText('Erro no servidor')
  expect(agentCalls.map((c) => c.body?.request_id)).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001'])
  // Mesma pergunta digitada de novo (não pelo botão) também reutiliza.
  clickSend()
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[2].body?.request_id).toBe('00000000-0000-4000-8000-000000000001')
  expect(uuidCounter).toBe(1)

  // Depois do sucesso, a mesma pergunta recebe id novo.
  type('pergunta A')
  clickSend()
  await waitFor(() => expect(agentCalls).toHaveLength(4))
  expect(agentCalls[3].body?.request_id).toBe('00000000-0000-4000-8000-000000000002')
})

test('request_id novo quando o texto muda depois de uma falha', async () => {
  await open()
  agentHandler = (_c, n) => (n === 1 ? json(500, { error: { code: 'INTERNAL_ERROR' } }) : completed())
  type('pergunta A')
  clickSend()
  await screen.findByText('Erro no servidor')
  type('pergunta B')
  clickSend()
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[0].body?.request_id).not.toBe(agentCalls[1].body?.request_id)
  expect(agentCalls[1].body?.message).toBe('pergunta B')
})

test('erro de rede: mensagem clara, mesmo request_id no reenvio', async () => {
  await open()
  agentHandler = (_c, n) => {
    if (n === 1) throw new TypeError('Failed to fetch')
    return completed()
  }
  type('pergunta')
  clickSend()
  expect(await screen.findByText('Sem conexão com o servidor')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[1].body?.request_id).toBe(agentCalls[0].body?.request_id)
})

test('timeout aborta o pedido (AbortController) e permite tentar de novo com o mesmo request_id', async () => {
  chatConfig.timeoutMs = 20
  await open()
  let aborted = false
  agentHandler = (_c, n, signal) =>
    n === 1
      ? new Promise<Response>((_resolve, reject) =>
          signal?.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('abortado', 'AbortError'))
          }),
        )
      : completed()
  type('pergunta')
  clickSend()
  expect(await screen.findByText('O servidor demorou demais')).toBeTruthy()
  expect(aborted).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[1].body?.request_id).toBe(agentCalls[0].body?.request_id)
})

test('202 processing: nova tentativa automática depois da pausa, com o mesmo request_id', async () => {
  await open()
  agentHandler = (_c, n) => (n <= 2 ? json(202, { status: 'processing' }, { 'Retry-After': '3' }) : completed())
  type('pergunta')
  clickSend()
  await screen.findByText('Resposta recebida.')
  expect(agentCalls).toHaveLength(3)
  expect(new Set(agentCalls.map((c) => c.body?.request_id)).size).toBe(1)
})

test('202 que não termina: mostra "Ainda processando" e o botão reenvia com o mesmo request_id', async () => {
  await open()
  agentHandler = (_c, n) => (n <= chatConfig.processingMaxAttempts ? json(202, { status: 'processing' }) : completed())
  type('pergunta')
  clickSend()
  expect(await screen.findByText('Ainda processando')).toBeTruthy()
  expect(agentCalls).toHaveLength(chatConfig.processingMaxAttempts)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  await screen.findByText('Resposta recebida.')
  expect(new Set(agentCalls.map((c) => c.body?.request_id)).size).toBe(1)
})

test('409: mensagem clara, sem repetir; o próximo envio recebe request_id novo', async () => {
  await open()
  agentHandler = (_c, n) => (n === 1 ? json(409, { error: { code: 'REQUEST_CONFLICT', message: 'eco' } }) : completed())
  type('pergunta')
  clickSend()
  expect(await screen.findByText('Pedido em conflito')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull()
  clickSend()
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[1].body?.request_id).not.toBe(agentCalls[0].body?.request_id)
})

test('422 UNSUPPORTED_ASSET: mensagem própria e atalho para o seletor', async () => {
  await open()
  agentHandler = () => json(422, { error: { code: 'UNSUPPORTED_ASSET', message: 'eco', details: { asset_ids: ['ZZZZ9'] } } })
  type('pergunta')
  clickSend()
  expect(await screen.findByText('Ação não reconhecida')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abrir o seletor' }))
  expect(await screen.findByRole('dialog', { name: 'Escolher ações e indicadores' })).toBeTruthy()
})

test('503 DATA_UNAVAILABLE: avisa que os dados ainda não foram coletados', async () => {
  await open()
  agentHandler = () => json(503, { error: { code: 'DATA_UNAVAILABLE', message: 'eco' } })
  type('pergunta')
  clickSend()
  expect(await screen.findByText('Dados ainda não coletados')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy()
})

test('401: encerra a sessão e leva para /entrar', async () => {
  await open()
  agentHandler = () => json(401, { error: { code: 'UNAUTHENTICATED' } })
  type('pergunta')
  clickSend()
  expect(await screen.findByRole('button', { name: /Entrar com Google/ })).toBeTruthy()
  expect(fake.client.auth.signOut).toHaveBeenCalled()
})

test('403: relê a autorização e mostra acesso não autorizado', async () => {
  await open()
  agentHandler = () => {
    fake.revoke('u1')
    return json(403, { error: { code: 'ACCESS_DENIED' } })
  }
  type('pergunta')
  clickSend()
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Acesso não autorizado'))
  expect(screen.queryByLabelText('Sua pergunta')).toBeNull()
})

// --- Limite da pergunta ---

test('contador acessível e limite de 8.000 caracteres: acima dele não envia', async () => {
  await open()
  type('abc')
  expect(screen.getByText('3 de 8.000 caracteres')).toBeTruthy()
  expect(screen.getByLabelText('Sua pergunta').getAttribute('aria-describedby')).toContain(screen.getByText('3 de 8.000 caracteres').id)
  type('a'.repeat(8001))
  expect(screen.getByText(/8001 de 8.000 caracteres: acima do limite/)).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('no máximo 8.000')
  expect(sendButton().getAttribute('aria-disabled')).toBe('true')
  clickSend()
  expect(agentCalls).toHaveLength(0)
  type('a'.repeat(8000))
  clickSend()
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[0].body?.message).toHaveLength(8000)
})

test('pergunta em branco não envia', async () => {
  await open()
  type('   ')
  clickSend()
  expect((await screen.findByRole('alert')).textContent).toContain('Digite uma pergunta')
  expect(agentCalls).toHaveLength(0)
})

// --- Seletor manual ---

async function openSelectorByButton() {
  fireEvent.click(screen.getByRole('button', { name: 'Escolher ações e indicadores' }))
  return screen.findByRole('dialog', { name: 'Escolher ações e indicadores' })
}

test('needs_selection abre o seletor com o motivo em texto fixo, sem eco do servidor', async () => {
  await open()
  agentHandler = () =>
    json(200, {
      status: 'needs_selection',
      reason: { code: 'LLM_QUOTA_EXHAUSTED' },
      content: 'TEXTO LIVRE DO SERVIDOR',
      warnings: [{ code: 'LLM_QUOTA_EXHAUSTED', message: 'ECO <b>x</b>' }],
    })
  type('compare DEMO3')
  clickSend()
  const dialog = await screen.findByRole('dialog', { name: 'Escolher ações e indicadores' })
  expect(within(dialog).getByRole('status').textContent).toContain('O limite diário do modo por IA foi atingido.')
  expect(within(dialog).getByRole('status').textContent).toContain('A sua pergunta será enviada junto')
  expect(dialog.textContent).not.toMatch(/TEXTO LIVRE|ECO/)
  // A pergunta digitada continua na caixa e nenhuma mensagem foi gravada.
  expect((screen.getByLabelText('Sua pergunta') as HTMLTextAreaElement).value).toBe('compare DEMO3')
  expect(messageItems()).toHaveLength(0)
})

test.each([
  ['LLM_INVALID_OUTPUT', 'Não consegui interpretar a pergunta com segurança.'],
  ['LLM_UNSUPPORTED', 'A pergunta pede algo que esta versão não cobre.'],
  ['LLM_QUOTA_EXHAUSTED', 'O limite diário do modo por IA foi atingido.'],
  ['LLM_QUOTA_UNAVAILABLE', 'Não foi possível conferir o limite diário do modo por IA.'],
  ['LLM_PROVIDER_ERROR', 'O serviço de IA não respondeu como esperado.'],
  ['LLM_TIMEOUT', 'O serviço de IA demorou demais para responder.'],
  ['LLM_DISABLED', 'O modo por IA está desligado.'],
  ['LLM_INPUT_TOO_LONG', 'A pergunta é longa demais para o modo por IA.'],
  ['LLM_NO_UNIVERSE', 'Não há ações cadastradas para o modo por IA consultar.'],
  ['CODIGO_NOVO', 'A pergunta não pôde ser interpretada automaticamente.'],
])('motivo %s tem texto fixo em português', async (code, text) => {
  await open()
  agentHandler = () => json(200, { status: 'needs_selection', reason: { code } })
  type('pergunta')
  clickSend()
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByRole('status').textContent).toContain(text)
})

test('confirmar a seleção reenvia a mesma mensagem com a seleção e um request_id NOVO', async () => {
  await open()
  agentHandler = (call) =>
    call.body?.selection
      ? (serverWritesTurn(String(call.body.message)), completed())
      : json(200, { status: 'needs_selection', reason: { code: 'LLM_INVALID_OUTPUT' } })
  type('compare DEMO3 e TEST4')
  clickSend()
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('checkbox', { name: /TEST4/ })
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /TEST4/ }))
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /DEMO3/ }))
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Dividend yield' }))
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'P/VP' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Consultar' }))
  await screen.findByText('Resposta recebida.')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(agentCalls).toHaveLength(2)
  expect(agentCalls[1].body).toEqual({
    request_id: '00000000-0000-4000-8000-000000000002',
    conversation_id: conversationId,
    message: 'compare DEMO3 e TEST4',
    // Na ordem do catálogo, não na ordem dos cliques; só asset_ids e metrics.
    selection: { asset_ids: ['DEMO3', 'TEST4'], metrics: ['price_to_book', 'dividend_yield'] },
  })
  expect(agentCalls[1].body?.request_id).not.toBe(agentCalls[0].body?.request_id)
  expect(Object.keys(agentCalls[1].body?.selection as object).sort()).toEqual(['asset_ids', 'metrics'])
  await waitFor(() => expect(messageItems().length).toBeGreaterThan(0))
})

test('seleção manual sem mensagem: o corpo não traz message', async () => {
  await open()
  const dialog = await openSelectorByButton()
  fireEvent.click(await within(dialog).findByRole('checkbox', { name: /DEMO3/ }))
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'ROE' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Consultar' }))
  await screen.findByText('Resposta recebida.')
  expect(agentCalls[0].body).toEqual({
    request_id: '00000000-0000-4000-8000-000000000001',
    conversation_id: conversationId,
    selection: { asset_ids: ['DEMO3'], metrics: ['roe'] },
  })
})

test('seleção repetida depois de falha reutiliza o request_id; outra seleção usa um novo', async () => {
  await open()
  agentHandler = (_c, n) => (n <= 2 ? json(500, { error: { code: 'INTERNAL_ERROR' } }) : completed())
  const pick = async (asset: RegExp) => {
    const dialog = await openSelectorByButton()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: asset }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'ROE' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Consultar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  }
  await pick(/DEMO3/)
  await screen.findByText('Erro no servidor')
  await pick(/DEMO3/)
  await waitFor(() => expect(agentCalls).toHaveLength(2))
  expect(agentCalls[1].body?.request_id).toBe(agentCalls[0].body?.request_id)
  await screen.findByText('Erro no servidor')
  await pick(/TEST4/)
  await waitFor(() => expect(agentCalls).toHaveLength(3))
  expect(agentCalls[2].body?.request_id).not.toBe(agentCalls[1].body?.request_id)
})

test('seletor valida de 1 a 20 ações e de 1 a 5 indicadores antes de enviar', async () => {
  await open()
  const dialog = await openSelectorByButton()
  await within(dialog).findByRole('checkbox', { name: /DEMO3/ })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Consultar' }))
  expect(within(dialog).getByRole('alert').textContent).toContain('pelo menos uma ação')
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /DEMO3/ }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Consultar' }))
  expect(within(dialog).getByRole('alert').textContent).toContain('pelo menos um indicador')
  expect(agentCalls).toHaveLength(0)
})

test('seletor: grupos com fieldset e legend, busca simples e link de consulta só https', async () => {
  catalogHandler = () => {
    const body = catalogBody() as { assets: { reference_url: string | null }[] }
    body.assets[1].reference_url = 'javascript:alert(1)'
    return json(200, body)
  }
  await open()
  const dialog = await openSelectorByButton()
  await within(dialog).findByRole('checkbox', { name: /DEMO3/ })
  expect(within(dialog).getByRole('group', { name: /Ações/ })).toBeTruthy()
  expect(within(dialog).getByRole('group', { name: /Indicadores/ })).toBeTruthy()
  expect(within(dialog).getAllByRole('checkbox')).toHaveLength(3 + 5)
  fireEvent.change(within(dialog).getByLabelText('Buscar ação'), { target: { value: 'teste' } })
  expect(within(dialog).getAllByRole('checkbox', { name: /S\.A\./ })).toHaveLength(1)
  fireEvent.change(within(dialog).getByLabelText('Buscar ação'), { target: { value: 'zzz' } })
  expect(within(dialog).getByText('Nenhuma ação corresponde à busca.')).toBeTruthy()
  fireEvent.change(within(dialog).getByLabelText('Buscar ação'), { target: { value: '' } })
  const links = within(dialog).getAllByRole('link')
  expect(links).toHaveLength(1) // DEMO3 (https); TEST4 (javascript:) e ONEA3 (null) sem link
  expect(links[0].getAttribute('href')).toBe('https://statusinvest.com.br/acoes/demo3')
  expect(links[0].getAttribute('rel')).toBe('noopener noreferrer')
})

test('seletor: Esc fecha e devolve o foco; Tab fica preso no diálogo', async () => {
  await open()
  const opener = screen.getByRole('button', { name: 'Escolher ações e indicadores' })
  opener.focus()
  const dialog = await openSelectorByButton()
  await within(dialog).findByRole('checkbox', { name: /DEMO3/ })
  expect(document.activeElement).toBe(within(dialog).getByRole('heading', { name: 'Escolher ações e indicadores' }))
  const cancel = within(dialog).getByRole('button', { name: 'Cancelar' })
  const consult = within(dialog).getByRole('button', { name: 'Consultar' })
  consult.focus()
  fireEvent.keyDown(consult, { key: 'Tab' })
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(consult)
  cancel.focus()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('catálogo: carregando, erro com nova tentativa e vazio', async () => {
  let release: () => void = () => {}
  catalogHandler = async (_c, n) => {
    if (n === 1) await new Promise<void>((resolve) => (release = resolve))
    return n === 1 ? json(500, { error: { code: 'INTERNAL_ERROR' } }) : json(200, catalogBody())
  }
  await open()
  const dialog = await openSelectorByButton()
  expect(within(dialog).getByText('Carregando ações e indicadores...')).toBeTruthy()
  release()
  expect(await within(dialog).findByText('Não foi possível carregar o catálogo')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar de novo' }))
  expect(await within(dialog).findByRole('checkbox', { name: /DEMO3/ })).toBeTruthy()
})

test('catálogo sem ações mostra o estado vazio', async () => {
  catalogHandler = () => json(200, { ...catalogBody(null), assets: [] })
  await open()
  const dialog = await openSelectorByButton()
  expect(await within(dialog).findByText('Nenhuma ação cadastrada')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('catálogo com snapshot null (universe_version null) é tolerado e avisa', async () => {
  catalogHandler = () => json(200, catalogBody(null))
  await open()
  const dialog = await openSelectorByButton()
  expect(await within(dialog).findByText(/dados ainda não foram coletados/)).toBeTruthy()
  // Segue permitindo escolher; quem responde é o backend (503 DATA_UNAVAILABLE).
  expect(within(dialog).getByRole('checkbox', { name: /DEMO3/ })).toBeTruthy()
})

test('o catálogo é lido com o Bearer do usuário', async () => {
  await open()
  await waitFor(() => expect(catalogCalls).toHaveLength(1))
  expect(catalogCalls[0].method).toBe('GET')
  expect(catalogCalls[0].headers.Authorization).toBe('Bearer token-u1')
})
