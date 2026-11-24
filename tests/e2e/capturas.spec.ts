// Capturas de tela (T21f, passo 4): cada tela em tema claro e escuro, em 1280 px e em 390 px
// de largura, escala 1x. Por padrão grava em test-results/capturas (ignorado pelo git);
// `npm run e2e:capturas` grava em docs/capturas. Só dados do seed (DEMO3, TEST4).
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { DEMO3_ID, TEST4_ID, expect, injectSession, setLlmMode, test, type Theme } from './support/fixtures'
import { consultSelection, isAgentResponse, seedConversation, settle, waitForTable } from './support/steps'

const OUT = process.env.CAPTURAS_DIR || 'test-results/capturas'

const SIZES = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const
const THEMES: Theme[] = ['claro', 'escuro']

for (const size of SIZES) {
  for (const theme of THEMES) {
    test(`telas em ${size.width} px, tema ${theme}`, async ({ browser, account }) => {
      test.setTimeout(120_000)
      await mkdir(OUT, { recursive: true })
      const context = await browser.newContext({
        viewport: size,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        acceptDownloads: true,
      })
      const page = await context.newPage()
      const shot = async (name: string, options: { fullPage?: boolean } = {}) => {
        await settle(page)
        await page.screenshot({
          path: join(OUT, `t21f-${name}-${size.width}-${theme === 'claro' ? 'claro' : 'escuro'}.png`),
          fullPage: options.fullPage ?? false,
          animations: 'disabled',
          caret: 'hide',
        })
      }
      try {
        // 1. Entrar (sem sessão).
        await page.addInitScript((t) => localStorage.setItem('tema', t), theme)
        await page.goto('/entrar')
        await expect(page.getByRole('button', { name: 'Entrar com Google' })).toBeVisible()
        await shot('entrar')

        // Daqui em diante, com a sessão do usuário de teste.
        await injectSession(page, account, theme)

        // 2. Lista de conversas (criadas direto no banco local, com títulos legíveis).
        await seedConversation(account, 'Comparar DEMO3 e TEST4')
        await seedConversation(account, 'Dividend yield da DEMO3')
        await page.goto('/')
        await expect(page.getByRole('link', { name: 'Comparar DEMO3 e TEST4' })).toBeVisible()
        await shot('lista')

        // 3. Chat com a tabela e seletor manual.
        await page.getByRole('link', { name: 'Comparar DEMO3 e TEST4' }).click()
        await expect(page.getByText('Nenhuma mensagem ainda')).toBeVisible()
        await page.getByRole('button', { name: 'Escolher ações e indicadores' }).click()
        const dialog = page.getByRole('dialog', { name: 'Escolher ações e indicadores' })
        await expect(dialog.getByRole('checkbox', { name: /DEMO3/ })).toBeVisible()
        await dialog.getByRole('checkbox', { name: /DEMO3/ }).check()
        await dialog.getByRole('checkbox', { name: 'P/VP' }).check()
        await shot('seletor')
        await dialog.getByRole('button', { name: 'Cancelar' }).click()
        await expect(dialog).toHaveCount(0)

        await consultSelection(page)
        await waitForTable(page)
        await page.evaluate(() => window.scrollTo(0, 0))
        await shot('chat')
        // Os quatro estados (conferido, divergente, não comparável, sem dado) na mesma imagem.
        for (const id of ['cell-DEMO3-price_to_book', 'cell-DEMO3-dividend_yield', 'cell-TEST4-price_to_earnings', 'cell-TEST4-roe']) {
          await expect(page.getByTestId(id)).toBeVisible()
        }
        await shot('tabela-estados', { fullPage: true })

        // 4. needs_selection com o motivo (sem LLM: o handler real responde LLM_DISABLED).
        await setLlmMode('disabled')
        await page.goto('/')
        await page.getByRole('link', { name: 'Dividend yield da DEMO3' }).click()
        await expect(page.getByText('Nenhuma mensagem ainda')).toBeVisible()
        await page.getByLabel('Sua pergunta').fill('Qual o dividend yield da DEMO3?')
        const answered = page.waitForResponse(isAgentResponse)
        await page.getByRole('button', { name: 'Enviar pergunta' }).click()
        expect((await (await answered).json()).status).toBe('needs_selection')
        const reason = page.getByRole('dialog', { name: 'Escolher ações e indicadores' }).getByRole('status')
        await expect(reason).toContainText('O modo por IA está desligado.')
        await shot('needs-selection')
        await setLlmMode('mock')

        // 5. Carteira vazia e com itens.
        await page.goto('/carteira')
        await expect(page.getByText('Sua carteira está vazia')).toBeVisible()
        await shot('carteira-vazia')
        await page.getByLabel('Ação do sistema').selectOption(DEMO3_ID)
        await page.getByRole('button', { name: 'Adicionar' }).click()
        await expect(page.getByText('DEMO3 adicionada à carteira.')).toBeVisible()
        await page.getByLabel('Ação do sistema').selectOption(TEST4_ID)
        await page.getByRole('button', { name: 'Adicionar' }).click()
        await expect(page.getByText('TEST4 adicionada à carteira.')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Remover TEST4 da carteira' })).toBeVisible()
        await shot('carteira')

        // 6. Painel de dados e exportação.
        await page.goto('/dados')
        await expect(page.getByRole('region', { name: 'Último lote de dados' })).toBeVisible()
        await shot('dados')
        const download = page.waitForEvent('download')
        await page.getByRole('button', { name: 'Exportar meus dados' }).click()
        await download
        const done = page.getByText(/Exportação concluída/)
        await expect(done).toBeVisible()
        await done.scrollIntoViewIfNeeded()
        await shot('exportacao')

        // 7. Aviso legal, pelo rodapé.
        await page.getByRole('link', { name: 'Aviso legal' }).click()
        await expect(page.getByRole('heading', { level: 1 })).toContainText(/aviso legal/i)
        await shot('aviso-legal')
      } finally {
        await setLlmMode('mock')
        await context.close()
      }
    })
  }
}
