import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'
import { catalogBody, seedPayload } from '@/features/chat/fixtures'
import { downloadText, exportConfig, exportFileName, FORMAT_VERSION, REVOKE_DELAY_MS } from './exportData'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

const defaults = { ...exportConfig }
let fetchMock: ReturnType<typeof vi.fn>
let blobs: Blob[] = []
let clicks: { href: string; name: string }[] = []
let revoked: string[] = []

beforeEach(() => {
  fake.reset()
  fake.signIn('u1')
  fake.allow('u1')
  Object.assign(exportConfig, defaults)
  blobs = []
  clicks = []
  revoked = []
  // Só o catálogo (leitura da tela) pode usar fetch; a exportação não.
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/functions/v1/catalog')) {
      return new Response(JSON.stringify(catalogBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    throw new Error(`rede inesperada: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob)
    return `blob:teste/${blobs.length}`
  })
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, name: this.download })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function readBlob(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

async function openAndExport() {
  renderApp('/dados')
  await screen.findByText('11 de 12 ativos atualizados')
  fireEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }))
}

function seed() {
  const c1 = fake.addConversation('Primeira')
  const c2 = fake.addConversation('Segunda')
  fake.addConversation('Do outro usuário', 'u2')
  fake.addMessage(c1.id as string, { role: 'user', sequence_no: 1, content: 'Qual o P/VP de DEMO3?' })
  fake.addMessage(c1.id as string, { role: 'assistant', sequence_no: 2, content: 'Resposta', payload: seedPayload() })
  fake.addMessage(c2.id as string, { role: 'user', sequence_no: 1, content: 'Oi' })
  fake.addMessage('c-outro', { role: 'user', sequence_no: 1, content: 'segredo do outro' }, 'u2')
  fake.addPortfolioItem('11111111-1111-4111-8111-111111111111')
  fake.addPortfolioItem('22222222-2222-4222-8222-222222222222')
  fake.addPortfolioItem('33333333-3333-4333-8333-333333333333', 'u2')
}

test('gera um JSON com conversas, mensagens e carteira, data da exportação e versão do formato', async () => {
  seed()
  await openAndExport()
  expect(await screen.findByText(/Exportação concluída/)).toBeTruthy()
  expect(blobs).toHaveLength(1)
  expect(blobs[0].type).toBe('application/json')
  const file = JSON.parse(await readBlob(blobs[0]))
  expect(file.format_version).toBe(FORMAT_VERSION)
  expect(file.format_version).toBe(1)
  expect(file.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(file.complete).toBe(true)
  expect(file.conversations.map((c: { title: string }) => c.title).sort()).toEqual(['Primeira', 'Segunda'])
  expect(file.messages).toHaveLength(3)
  expect(file.portfolio_items.map((p: { asset_id: string }) => p.asset_id).sort()).toEqual([
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
  ])
  expect(Object.keys(file.portfolio_items[0]).sort()).toEqual(['asset_id', 'created_at', 'id'])
  // a carteira sai com o identificador interno, e o arquivo avisa disso
  expect(file.notas.join(' ')).toContain('identificador interno')
  expect(file.notas.join(' ')).toContain('símbolo')
})

test('não leva dados de outra conta, user_id, e-mail, chaves nem tokens', async () => {
  seed()
  await openAndExport()
  await screen.findByText(/Exportação concluída/)
  const text = await readBlob(blobs[0])
  expect(text).not.toContain('user_id')
  expect(text).not.toContain('segredo do outro')
  expect(text).not.toContain('Do outro usuário')
  expect(text).not.toContain('33333333')
  expect(text).not.toContain('token-u1')
  expect(text).not.toMatch(/@|apikey|Bearer/i)
})

test('o payload e os valores financeiros saem exatamente como estão (strings)', async () => {
  seed()
  await openAndExport()
  await screen.findByText(/Exportação concluída/)
  const text = await readBlob(blobs[0])
  const file = JSON.parse(text)
  const withPayload = file.messages.find((m: { payload: unknown }) => m.payload !== null)
  expect(withPayload.payload).toEqual(seedPayload())
  // zeros à direita e casas decimais preservados, sempre entre aspas
  expect(text).toContain('"1.50"')
  expect(text).toContain('"0.0302"')
  expect(text).toContain('"8.50"')
  expect(text).not.toMatch(/"value":\s*[0-9]/)
  expect(text).toContain('\n  "format_version"') // indentado
})

test('várias páginas: lê tudo, sem truncar', async () => {
  exportConfig.pageSize = 2
  const c1 = fake.addConversation('A')
  const c2 = fake.addConversation('B')
  for (let i = 1; i <= 7; i += 1) fake.addMessage(c1.id as string, { role: i % 2 ? 'user' : 'assistant', sequence_no: i, content: `m${i}` })
  for (let i = 1; i <= 4; i += 1) fake.addMessage(c2.id as string, { role: i % 2 ? 'user' : 'assistant', sequence_no: i, content: `n${i}` })
  for (let i = 1; i <= 5; i += 1) fake.addPortfolioItem(`aaaaaaaa-0000-4000-8000-00000000000${i}`)
  await openAndExport()
  expect(await screen.findByText(/Exportação concluída/)).toBeTruthy()
  const file = JSON.parse(await readBlob(blobs[0]))
  expect(file.messages).toHaveLength(11)
  expect(file.portfolio_items).toHaveLength(5)
  expect(file.conversations).toHaveLength(2)
  expect(file.complete).toBe(true)
  expect(new Set(file.messages.map((m: { id: string }) => m.id)).size).toBe(11)
  // mensagens de cada conversa em ordem de sequência
  const seqs = file.messages.filter((m: { conversation_id: string }) => m.conversation_id === c1.id).map((m: { sequence_no: number }) => m.sequence_no)
  expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7])
  // 11 mensagens com páginas de 2: 6 páginas com dados e 1 vazia
  const reads = fake.state.log.filter((l) => l.table === 'messages' && l.op === 'select').length
  expect(reads).toBe(7)
  expect(screen.getByText(/11 mensagens/)).toBeTruthy()
})

test('limite de segurança atingido: o arquivo é marcado como incompleto e a tela avisa', async () => {
  exportConfig.pageSize = 2
  exportConfig.maxPages = 1
  const c = fake.addConversation('A')
  for (let i = 1; i <= 5; i += 1) fake.addMessage(c.id as string, { role: 'user', sequence_no: i, content: `m${i}` })
  await openAndExport()
  expect(await screen.findByText(/pode estar incompleto/)).toBeTruthy()
  const file = JSON.parse(await readBlob(blobs[0]))
  expect(file.complete).toBe(false)
  expect(file.messages).toHaveLength(2)
  expect(file.avisos.join(' ')).toContain('as mensagens')
})

test.each(['conversations', 'messages', 'portfolio_items'])('falha ao ler %s: nenhum arquivo é gerado e dá para tentar de novo', async (table) => {
  seed()
  fake.state.errors[`${table}.select`] = 'boom: detalhe interno'
  await openAndExport()
  const alert = await screen.findByText('Não foi possível exportar')
  expect(alert).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('Nenhum arquivo foi baixado')
  expect(screen.getByRole('alert').textContent).not.toContain('detalhe interno')
  expect(blobs).toHaveLength(0)
  expect(clicks).toHaveLength(0)
  expect(screen.queryByText(/Exportação concluída/)).toBeNull()

  fake.state.errors[`${table}.select`] = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByText(/Exportação concluída/)).toBeTruthy()
  expect(blobs).toHaveLength(1)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('falha numa página do meio também não gera arquivo parcial', async () => {
  exportConfig.pageSize = 2
  const c = fake.addConversation('A')
  for (let i = 1; i <= 5; i += 1) fake.addMessage(c.id as string, { role: 'user', sequence_no: i, content: `m${i}` })
  let reads = 0
  const original = fake.client.from
  vi.spyOn(fake.client, 'from').mockImplementation((table: string) => {
    if (table === 'messages' && ++reads === 2) fake.state.errors['messages.select'] = 'falha na segunda página'
    return original(table)
  })
  await openAndExport()
  expect(await screen.findByText('Não foi possível exportar')).toBeTruthy()
  expect(blobs).toHaveLength(0)
})

test('nenhuma requisição de rede além das leituras do banco, e nenhuma escrita', async () => {
  seed()
  renderApp('/dados')
  await screen.findByText('11 de 12 ativos atualizados')
  const fetchesBefore = fetchMock.mock.calls.length
  const logBefore = fake.state.log.length
  fireEvent.click(screen.getByRole('button', { name: 'Exportar meus dados' }))
  await screen.findByText(/Exportação concluída/)
  expect(fetchMock.mock.calls.length).toBe(fetchesBefore)
  const during = fake.state.log.slice(logBefore)
  expect(during.length).toBeGreaterThan(0)
  expect(during.every((l) => l.op === 'select')).toBe(true)
  expect(new Set(during.map((l) => l.table))).toEqual(new Set(['conversations', 'messages', 'portfolio_items']))
})

test('nome do arquivo sem dados pessoais, data da exportação e revogação da URL', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T01:30:00Z') }) // 22:30 de 16/11 em Brasília
  seed()
  await openAndExport()
  expect(await screen.findByText(/Exportação concluída/)).toBeTruthy()
  expect(clicks).toHaveLength(1)
  expect(clicks[0].name).toBe('exportacao-2026-11-16.json')
  expect(clicks[0].name).toMatch(/^exportacao-\d{4}-\d{2}-\d{2}\.json$/)
  expect(clicks[0].href).toBe('blob:teste/1')
  await waitFor(() => expect(revoked).toEqual(['blob:teste/1']))
  const file = JSON.parse(await readBlob(blobs[0]))
  expect(file.exported_at).toBe('2026-11-17T01:30:00.000Z')
  expect(screen.getByText(/exportacao-2026-11-16\.json/)).toBeTruthy()
  expect(document.querySelector('a[download]')).toBeNull() // o link temporário não fica na página
})

test('exportFileName usa a data de Brasília', () => {
  expect(exportFileName(new Date('2026-01-02T02:59:00Z'))).toBe('exportacao-2026-01-01.json')
  expect(exportFileName(new Date('2026-01-02T03:00:00Z'))).toBe('exportacao-2026-01-02.json')
})

test('estado de envio: aviso de progresso, botão sem clique duplo e aria-live', async () => {
  seed()
  let release: () => void = () => undefined
  fake.state.messagesGate = new Promise<void>((resolve) => (release = resolve))
  renderApp('/dados')
  await screen.findByText('11 de 12 ativos atualizados')
  const button = screen.getByRole('button', { name: 'Exportar meus dados' })
  fireEvent.click(button)
  const status = await screen.findByText(/Exportando: lendo/)
  expect(status.closest('[aria-live="polite"]')).toBeTruthy()
  expect(button.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(button) // clique duplo é ignorado
  release()
  await screen.findByText(/Exportação concluída/)
  expect(blobs).toHaveLength(1)
  expect(button.getAttribute('aria-disabled')).toBe('false')
  await waitFor(() => expect(screen.queryByText(/Exportando: lendo/)).toBeNull())
})

test('sem dados: exporta arquivo com listas vazias (vazio de verdade, não falha)', async () => {
  await openAndExport()
  expect(await screen.findByText(/Exportação concluída/)).toBeTruthy()
  const file = JSON.parse(await readBlob(blobs[0]))
  expect(file.conversations).toEqual([])
  expect(file.messages).toEqual([])
  expect(file.portfolio_items).toEqual([])
  expect(file.complete).toBe(true)
})

test('a URL é revogada depois do clique, não antes', () => {
  vi.useFakeTimers()
  downloadText('{}', 'x.json')
  expect(clicks).toHaveLength(1)
  expect(revoked).toEqual([])
  vi.advanceTimersByTime(REVOKE_DELAY_MS - 1)
  expect(revoked).toEqual([])
  vi.advanceTimersByTime(1)
  expect(revoked).toEqual(['blob:teste/1'])
})

test('o lembrete de backup semanal aparece na tela de exportação', async () => {
  renderApp('/dados')
  expect(await screen.findByText(/Guarde uma cópia por semana, fora do repositório/)).toBeTruthy()
})
