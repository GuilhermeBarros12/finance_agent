// Roteiros ponta a ponta (T21f, passo 3). Navegador real, banco local com o seed, handlers
// reais das funções (gateway local) e MOCK_LLM=true. Cada teste usa um usuário novo, apagado
// no fim. Nenhum teste depende da data de hoje.
import { readFile } from 'node:fs/promises'
import { DEMO3_ID, TEST4_ID, expect, setLlmMode, test } from './support/fixtures'
import { consultSelection, createAndOpenConversation, isAgentResponse, waitForTable } from './support/steps'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Percorre o JSON inteiro e devolve o caminho de cada chave com o nome dado.
function findKeys(value: unknown, name: string, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => findKeys(item, name, `${path}[${i}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(key === name ? [`${path}.${key}`] : []),
      ...findKeys(child, name, `${path}.${key}`),
    ])
  }
  return []
}

// Valores financeiros do payload têm de ser strings, nunca números.
const DECIMAL_KEYS = ['value_decimal', 'delta_abs', 'limit', 'atol', 'rtol']
function numericDecimals(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => numericDecimals(item, `${path}[${i}]`))
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(DECIMAL_KEYS.includes(key) && typeof child === 'number' ? [`${path}.${key}`] : []),
      ...numericDecimals(child, `${path}.${key}`),
    ])
  }
  return []
}

test.describe('roteiros', () => {
  test('entrar: a tela de login só oferece o Google', async ({ page }) => {
    await page.goto('/entrar')
    await expect(page.getByRole('heading', { name: 'Entrar', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible()
    // O login por e-mail e senha existe só na bancada de teste, fora da tela.
    await expect(page.getByLabel(/senha/i)).toHaveCount(0)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Aviso legal' })).toBeVisible()
  })

  test('(a) criar conversa, enviar uma seleção, ver a tabela e recarregar', async ({ signedPage: page, agentCalls }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Conversas', level: 1 })).toBeVisible()
    await expect(page.getByText('Nenhuma conversa ainda')).toBeVisible()

    const conversationId = await createAndOpenConversation(page)
    await expect(page.getByText('Nenhuma mensagem ainda')).toBeVisible()

    const response = await consultSelection(page)
    expect((await response.json()).status).toBe('completed')
    await waitForTable(page)

    // Os quatro estados do seed, cada um no seu campo, com texto (não só cor).
    const verified = page.getByTestId('cell-DEMO3-price_to_book')
    await expect(verified).toContainText('Conferido')
    await expect(verified).toContainText('1,50')
    const divergent = page.getByTestId('cell-DEMO3-dividend_yield')
    await expect(divergent).toContainText('Divergente')
    await expect(divergent).toContainText('8,50%')
    await expect(divergent).toContainText('9,10%')
    await expect(divergent).toContainText('As fontes divergem. Nenhum valor foi escolhido.')
    const incomparable = page.getByTestId('cell-TEST4-price_to_earnings')
    await expect(incomparable).toContainText('Não comparável')
    await expect(incomparable).toContainText('Datas-base diferentes entre as fontes')
    const missing = page.getByTestId('cell-TEST4-roe')
    await expect(missing).toContainText('Sem dado')
    await expect(missing).toContainText('Não disponível')
    await expect(page.getByText('2 de 2 ativos atualizados')).toBeVisible()

    // O que o navegador enviou: seleção, sem message e sem user_id.
    expect(agentCalls).toHaveLength(1)
    const body = agentCalls[0].body
    expect(Object.keys(body).sort()).toEqual(['conversation_id', 'request_id', 'selection'])
    expect(body.conversation_id).toBe(conversationId)
    expect(body.request_id).toMatch(UUID)
    expect(body.selection).toEqual({
      asset_ids: ['DEMO3', 'TEST4'],
      metrics: ['price_to_book', 'price_to_earnings', 'dividend_yield', 'roe'],
    })

    // Recarregar: a conversa e as mensagens vêm do banco.
    await page.reload()
    await waitForTable(page)
    await expect(page.getByRole('list', { name: 'Mensagens' })).toBeVisible()
    await expect(page.getByTestId('cell-TEST4-roe')).toContainText('Não disponível')
    expect(agentCalls).toHaveLength(1) // recarregar não reenvia nada

    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Nova conversa' })).toBeVisible()
  })

  test('(b) pergunta em texto: resposta do classificador simulado', async ({ signedPage: page, agentCalls }) => {
    await createAndOpenConversation(page)
    const question = 'Qual o dividend yield da DEMO3?'
    await page.getByLabel('Sua pergunta').fill(question)
    const answered = page.waitForResponse(isAgentResponse)
    await page.getByRole('button', { name: 'Enviar pergunta' }).click()
    const json = await (await answered).json()
    // MOCK_LLM: classificação fixa DEMO3 + dividend_yield, vinda do handler real.
    expect(json.status).toBe('completed')
    expect(json.intent_source).toBe('mock')

    const cell = page.getByTestId('cell-DEMO3-dividend_yield')
    await expect(cell).toBeVisible()
    await expect(cell).toContainText('Divergente')
    await expect(cell).toContainText('8,50%')
    await expect(cell).toContainText('9,10%')
    // Só o indicador classificado: nada de TEST4.
    await expect(page.getByTestId('cell-TEST4-roe')).toHaveCount(0)

    // A pergunta fica na conversa, uma vez só.
    const messages = page.getByRole('list', { name: 'Mensagens' })
    await expect(messages.getByText(question)).toHaveCount(1)

    const body = agentCalls[0].body
    expect(Object.keys(body).sort()).toEqual(['conversation_id', 'message', 'request_id'])
    expect(body.message).toBe(question)
  })

  test('(c) needs_selection: motivo e seletor manual', async ({ signedPage: page, agentCalls }) => {
    // Sem LLM (sem chave, sem simulação): o handler real responde needs_selection/LLM_DISABLED.
    await setLlmMode('disabled')
    await createAndOpenConversation(page)
    const question = 'Compare o P/L e o ROE das duas ações'
    await page.getByLabel('Sua pergunta').fill(question)
    const first = page.waitForResponse(isAgentResponse)
    await page.getByRole('button', { name: 'Enviar pergunta' }).click()
    const firstJson = await (await first).json()
    expect(firstJson.status).toBe('needs_selection')
    expect(firstJson.reason.code).toBe('LLM_DISABLED')

    // O seletor abre sozinho, com o motivo em texto fixo e a pergunta preservada.
    const dialog = page.getByRole('dialog', { name: 'Escolher ações e indicadores' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('status')).toContainText('O modo por IA está desligado.')
    await expect(dialog.getByRole('status')).toContainText('A sua pergunta será enviada junto com a escolha.')

    await dialog.getByRole('checkbox', { name: /TEST4/ }).check()
    await dialog.getByRole('checkbox', { name: 'P/L' }).check()
    await dialog.getByRole('checkbox', { name: 'ROE' }).check()
    const second = page.waitForResponse(isAgentResponse)
    await dialog.getByRole('button', { name: 'Consultar' }).click()
    expect((await (await second).json()).status).toBe('completed')

    await expect(page.getByTestId('cell-TEST4-price_to_earnings')).toContainText('Não comparável')
    await expect(page.getByTestId('cell-TEST4-roe')).toContainText('Não disponível')
    await expect(dialog).toHaveCount(0)

    // Duas chamadas: a de texto (sem seleção) e a manual (com seleção e a mesma pergunta),
    // com request_id diferentes. needs_selection não gravou a pergunta: aparece uma vez só.
    expect(agentCalls).toHaveLength(2)
    expect(agentCalls[0].body.selection).toBeUndefined()
    expect(agentCalls[1].body.message).toBe(question)
    expect(agentCalls[1].body.selection).toEqual({
      asset_ids: ['TEST4'],
      metrics: ['price_to_earnings', 'roe'],
    })
    expect(agentCalls[1].body.request_id).not.toBe(agentCalls[0].body.request_id)
    await expect(page.getByRole('list', { name: 'Mensagens' }).getByText(question)).toHaveCount(1)
  })

  test('(d) carteira: adicionar duas ações e atualizar a carteira', async ({ signedPage: page, agentCalls }) => {
    await page.goto('/carteira')
    await expect(page.getByRole('heading', { name: 'Carteira', level: 1 })).toBeVisible()
    await expect(page.getByText('Sua carteira está vazia')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Atualizar carteira' })).toHaveAttribute('aria-disabled', 'true')

    const select = page.getByLabel('Ação do sistema')
    await select.selectOption(DEMO3_ID)
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.getByText('DEMO3 adicionada à carteira.')).toBeVisible()
    await select.selectOption(TEST4_ID)
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.getByText('TEST4 adicionada à carteira.')).toBeVisible()

    // Fica no banco: sobrevive ao recarregamento, e as ações já presentes saem do seletor.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Remover DEMO3 da carteira' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remover TEST4 da carteira' })).toBeVisible()
    await expect(page.getByLabel('Ação do sistema').locator('option')).toHaveCount(1) // só o texto "Nenhuma ação disponível"

    await page.getByRole('button', { name: 'Atualizar carteira' }).click()
    await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]{36}$/)
    await waitForTable(page)
    await expect(page.getByTestId('cell-TEST4-roe')).toContainText('Sem dado')

    // selection com todas as ações e os cinco indicadores; sem message.
    expect(agentCalls).toHaveLength(1)
    const body = agentCalls[0].body
    expect(Object.keys(body).sort()).toEqual(['conversation_id', 'request_id', 'selection'])
    const selection = body.selection as { asset_ids: string[]; metrics: string[] }
    expect([...selection.asset_ids].sort()).toEqual(['DEMO3', 'TEST4'])
    expect([...selection.metrics].sort()).toEqual(
      ['dividend_yield', 'price_to_book', 'price_to_earnings', 'quote_price', 'roe'],
    )
  })

  test('(e) painel de dados: snapshot do seed, idade, estados e fontes', async ({ signedPage: page }) => {
    await page.goto('/dados')
    await expect(page.getByRole('heading', { name: 'Dados', level: 1 })).toBeVisible()
    const lote = page.getByRole('region', { name: 'Último lote de dados' })
    await expect(lote).toBeVisible()
    await expect(lote).toContainText('18/09/2026') // collected_at fixo do seed
    await expect(lote).toContainText('2 de 2 ativos atualizados')
    // A idade depende do relógio: só confere o formato, nunca um número.
    await expect(lote.getByTestId('idade')).toHaveText(/^(há \d+ (dias?|horas?)|há menos de 1 hora|agora há pouco)$/)
    // O estado de atualização é calculado pelo servidor; aceita qualquer um dos quatro.
    await expect(lote.getByText(/^(Atualizado|Desatualizado|Vencido|Data-base desconhecida)$/)).toBeVisible()

    // Contagem por estado de validação: um campo em cada um dos quatro estados do seed.
    const counts = page.getByRole('region', { name: 'Campos por estado de validação' })
    for (const label of ['Conferido', 'Divergente', 'Não comparável', 'Sem dado']) {
      await expect(counts.getByRole('listitem').filter({ hasText: label })).toContainText('1 campo')
    }
    await expect(page.getByRole('region', { name: 'Falhas de coleta' })).toBeVisible()

    // Fontes, com o estado de permissão registrado no front.
    const sources = page.getByRole('region', { name: /fontes/i })
    for (const name of ['Fundamentus', 'StatusInvest', 'brapi']) {
      await expect(sources.getByText(name, { exact: false }).first()).toBeVisible()
    }
  })

  test('(f) exportar os dados: download com conversas, mensagens e carteira', async ({ signedPage: page, account }) => {
    // Dados para exportar: uma conversa com resposta e uma ação na carteira.
    await createAndOpenConversation(page)
    await consultSelection(page)
    await waitForTable(page)
    await page.goto('/carteira')
    await page.getByLabel('Ação do sistema').selectOption(DEMO3_ID)
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.getByText('DEMO3 adicionada à carteira.')).toBeVisible()

    await page.goto('/dados')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar meus dados' }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^exportacao-\d{4}-\d{2}-\d{2}\.json$/)
    await expect(page.getByText(/Exportação concluída/)).toBeVisible()

    const path = await file.path()
    const text = await readFile(path, 'utf8')
    const json = JSON.parse(text)
    expect(json.format_version).toBe(1)
    expect(typeof json.exported_at).toBe('string')
    expect(Number.isNaN(Date.parse(json.exported_at))).toBe(false)
    expect(json.complete).toBe(true)
    expect(json.conversations).toHaveLength(1)
    expect(json.messages.length).toBeGreaterThanOrEqual(1)
    expect(json.portfolio_items).toHaveLength(1)
    expect(json.portfolio_items[0].symbol).toBe('DEMO3')
    expect(json.portfolio_items[0].asset_id).toBe(DEMO3_ID)

    // Sem identificador da conta: nenhuma chave user_id, nem o uuid ou o e-mail no texto.
    expect(findKeys(json, 'user_id')).toEqual([])
    expect(text).not.toContain(account.userId)
    expect(text).not.toContain(account.email)

    // O payload da resposta tem os valores como strings.
    const assistant = json.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(assistant.payload).toBeTruthy()
    const observations = assistant.payload.evidence.observations as { value_decimal: unknown }[]
    expect(observations.length).toBeGreaterThan(0)
    for (const o of observations) expect(typeof o.value_decimal).toBe('string')
    expect(numericDecimals(json)).toEqual([])
  })

  test('invariantes: a carteira não vai ao /agent com message e o navegador não envia user_id', async ({
    signedPage: page,
    agentCalls,
    account,
  }) => {
    await page.goto('/carteira')
    await page.getByLabel('Ação do sistema').selectOption(DEMO3_ID)
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.getByText('DEMO3 adicionada à carteira.')).toBeVisible()
    await page.getByLabel('Ação do sistema').selectOption(TEST4_ID)
    await page.getByRole('button', { name: 'Adicionar' }).click()
    await expect(page.getByText('TEST4 adicionada à carteira.')).toBeVisible()

    await createAndOpenConversation(page)
    await page.getByLabel('Sua pergunta').fill('Qual o dividend yield?')
    const answered = page.waitForResponse(isAgentResponse)
    await page.getByRole('button', { name: 'Enviar pergunta' }).click()
    expect((await (await answered).json()).status).toBe('completed')

    const withMessage = agentCalls.filter((c) => 'message' in c.body)
    expect(withMessage).toHaveLength(1)
    for (const call of agentCalls) {
      expect(findKeys(call.body, 'user_id')).toEqual([])
      expect(call.raw).not.toContain(account.userId)
      expect(call.raw).not.toContain(account.email)
    }
    // Corpo da pergunta em texto: só as três chaves, sem a carteira (nem símbolo nem uuid).
    const raw = withMessage[0].raw
    expect(Object.keys(withMessage[0].body).sort()).toEqual(['conversation_id', 'message', 'request_id'])
    expect(raw).not.toContain(DEMO3_ID)
    expect(raw).not.toContain(TEST4_ID)
    expect(raw).not.toContain('TEST4')
    expect(raw).not.toMatch(/portfolio|carteira/i)
  })

  test('falha de rede: a tela continua usável e o reenvio reaproveita o request_id', async ({
    signedPage: page,
    agentCalls,
  }) => {
    await createAndOpenConversation(page)
    await page.route('**/functions/v1/agent', (route) => route.abort('connectionrefused'))
    const question = 'Qual o dividend yield da DEMO3?'
    await page.getByLabel('Sua pergunta').fill(question)
    await page.getByRole('button', { name: 'Enviar pergunta' }).click()

    const alert = page.getByRole('alert').filter({ hasText: 'Sem conexão com o servidor' })
    await expect(alert).toBeVisible()
    // A tela não quebrou nem inventou dado: a pergunta continua na caixa e não há tabela.
    await expect(page.getByLabel('Sua pergunta')).toHaveValue(question)
    await expect(page.getByTestId('cell-DEMO3-dividend_yield')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Escolher ações e indicadores' })).toBeVisible()

    await page.unroute('**/functions/v1/agent')
    await alert.getByRole('button', { name: 'Tentar de novo' }).click()
    await expect(page.getByTestId('cell-DEMO3-dividend_yield')).toBeVisible()
    // O pedido falho nunca chegou ao servidor, e o reenvio usou o mesmo request_id.
    expect(agentCalls).toHaveLength(2)
    expect(agentCalls[1].body.request_id).toBe(agentCalls[0].body.request_id)
  })

  test('falha do catálogo em /dados: erro explícito, sem dado inventado, e recupera', async ({ signedPage: page }) => {
    await page.route('**/functions/v1/catalog', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL"}}' }),
    )
    await page.goto('/dados')
    const alert = page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o estado dos dados' })
    await expect(alert).toBeVisible()
    await expect(page.getByRole('region', { name: 'Último lote de dados' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Exportar meus dados' })).toBeVisible()

    await page.unroute('**/functions/v1/catalog')
    await alert.getByRole('button', { name: /tentar de novo/i }).click()
    await expect(page.getByRole('region', { name: 'Último lote de dados' })).toBeVisible()
  })
})
