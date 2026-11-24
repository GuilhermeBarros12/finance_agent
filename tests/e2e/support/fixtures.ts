import { test as base, expect, type Page, type Request } from '@playwright/test'
import { createAccount, deleteAccount, setLlmMode, type Account } from './account'

export type Theme = 'claro' | 'escuro'

// UUIDs das ações do seed (supabase/seed.sql). Tickers inventados.
export const DEMO3_ID = 'a0000000-0000-4000-8000-000000000001'
export const TEST4_ID = 'a0000000-0000-4000-8000-000000000002'

export interface AgentCall {
  body: Record<string, unknown>
  raw: string
}

interface Fixtures {
  account: Account
  // Página já com a sessão do usuário de teste injetada no localStorage do supabase-js.
  signedPage: Page
  // Corpos enviados a /functions/v1/agent, na ordem.
  agentCalls: AgentCall[]
}

export async function injectSession(page: Page, account: Account, theme: Theme = 'claro') {
  await page.addInitScript(
    ({ key, value, theme }) => {
      localStorage.setItem(key, JSON.stringify(value))
      localStorage.setItem('tema', theme)
    },
    { key: account.storageKey, value: account.session, theme },
  )
}

export const test = base.extend<Fixtures>({
  account: async ({}, use) => {
    const account = await createAccount()
    try {
      await use(account)
    } finally {
      await deleteAccount(account)
      // O modo de LLM volta ao simulado mesmo se um roteiro o tiver alterado.
      await setLlmMode('mock')
    }
  },
  agentCalls: async ({ page }, use) => {
    const calls: AgentCall[] = []
    page.on('request', (request: Request) => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/functions/v1/agent') {
        const raw = request.postData() ?? ''
        calls.push({ body: JSON.parse(raw) as Record<string, unknown>, raw })
      }
    })
    await use(calls)
  },
  signedPage: async ({ page, account, agentCalls }, use) => {
    void agentCalls
    await injectSession(page, account)
    await use(page)
  },
})

export { expect }
export { setLlmMode }
