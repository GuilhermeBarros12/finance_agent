// Passos reutilizados pelos roteiros e pelas capturas. Esperas sempre por estado visível
// (papéis, textos, respostas de rede), nunca por tempo fixo.
import { expect, type Page, type Response } from '@playwright/test'
import { readLocalSupabase } from './local-supabase'
import type { Account } from './account'

export const METRICS_LABEL = ['P/VP', 'Dividend yield', 'P/L', 'ROE'] as const

// Cria conversas direto no banco local (API administrativa local), para preparar telas
// sem depender do clique. O dono é o usuário de teste.
export async function seedConversation(account: Account, title: string): Promise<string> {
  const { apiUrl, adminKey } = readLocalSupabase()
  const response = await fetch(`${apiUrl}/rest/v1/conversations`, {
    method: 'POST',
    headers: {
      apikey: adminKey,
      Authorization: `Bearer ${adminKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ user_id: account.userId, title }),
  })
  if (!response.ok) throw new Error(`seed da conversa: HTTP ${response.status}`)
  const rows = (await response.json()) as { id: string }[]
  return rows[0].id
}

export const isAgentResponse = (response: Response) =>
  response.request().method() === 'POST' && new URL(response.url()).pathname === '/functions/v1/agent'

// Cria uma conversa pela tela e abre o chat dela.
export async function createAndOpenConversation(page: Page): Promise<string> {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Conversas', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Nova conversa' }).click()
  await expect(page.getByText('Conversa criada.')).toBeVisible()
  await page.getByRole('link', { name: 'Nova conversa' }).click()
  await expect(page).toHaveURL(/\/conversas\/[0-9a-f-]{36}$/)
  return new URL(page.url()).pathname.split('/').pop() as string
}

// Abre o seletor manual, marca DEMO3 e TEST4 e os quatro indicadores que o seed cobre
// (P/VP, Dividend yield, P/L, ROE) e envia. Devolve a resposta HTTP do /agent.
export async function consultSelection(page: Page): Promise<Response> {
  await page.getByRole('button', { name: 'Escolher ações e indicadores' }).click()
  const dialog = page.getByRole('dialog', { name: 'Escolher ações e indicadores' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('checkbox', { name: /DEMO3/ }).check()
  await dialog.getByRole('checkbox', { name: /TEST4/ }).check()
  for (const label of METRICS_LABEL) await dialog.getByRole('checkbox', { name: label }).check()
  const answered = page.waitForResponse(isAgentResponse)
  await dialog.getByRole('button', { name: 'Consultar' }).click()
  return answered
}

export async function waitForTable(page: Page) {
  await expect(page.getByTestId('cell-DEMO3-price_to_book')).toBeVisible()
}

// Fontes e fontes de tema prontas antes de qualquer captura.
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
}
