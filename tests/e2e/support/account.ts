// Usuário de teste, só no Supabase LOCAL. Cada teste cria um usuário novo pela API
// administrativa local (chave lida de `supabase status` em tempo de execução), com senha
// aleatória gerada na hora, e o apaga no fim: conversas, mensagens, carteira e execuções
// saem junto (on delete cascade). Nada daqui existe em ambiente hospedado.
import { randomBytes, randomUUID } from 'node:crypto'
import { GATEWAY_URL, readLocalSupabase } from './local-supabase'

export interface Account {
  userId: string
  email: string
  // Sessão no formato que o supabase-js guarda no localStorage.
  session: Record<string, unknown>
  storageKey: string
}

async function call(path: string, init: RequestInit & { key: string; headers?: Record<string, string> }) {
  const { apiUrl } = readLocalSupabase()
  const { key, headers, ...rest } = init
  const response = await fetch(`${apiUrl}${path}`, {
    ...rest,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return text ? (JSON.parse(text) as Record<string, unknown>) : {}
}

// Chave de armazenamento do supabase-js: sb-<primeiro rótulo do host>-auth-token.
export function storageKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
}

export async function createAccount(): Promise<Account> {
  const { adminKey, anonKey } = readLocalSupabase()
  const email = `e2e-${randomUUID()}@exemplo.invalid`
  const password = randomBytes(24).toString('base64url')
  const created = await call('/auth/v1/admin/users', {
    method: 'POST',
    key: adminKey,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const userId = String(created.id)
  // allowed_users: sem a linha, a tela mostraria "acesso não autorizado".
  await call('/rest/v1/allowed_users', {
    method: 'POST',
    key: adminKey,
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ user_id: userId, enabled: true }),
  })
  // signInWithPassword: a mesma chamada que o cliente supabase-js faz, feita aqui no Node.
  const session = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: anonKey,
    body: JSON.stringify({ email, password }),
  })
  return { userId, email, session, storageKey: storageKeyFor(GATEWAY_URL) }
}

export async function deleteAccount(account: Account): Promise<void> {
  const { adminKey } = readLocalSupabase()
  await call(`/auth/v1/admin/users/${account.userId}`, { method: 'DELETE', key: adminKey })
}

export async function setLlmMode(mode: 'mock' | 'disabled'): Promise<void> {
  const response = await fetch(`${GATEWAY_URL}/__e2e/llm-mode`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  })
  if (!response.ok) throw new Error('gateway: modo de LLM não aceito')
}
