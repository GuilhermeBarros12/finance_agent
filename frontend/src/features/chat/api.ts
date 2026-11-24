import { functionUrl, publishableKey } from '@/lib/config'
import { supabase } from '@/lib/supabase'
import { readCatalog, type Catalog } from './contracts'

// --- Leitura do banco (JWT do usuário; a RLS decide o que aparece) ---

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  sequence_no: number
  content: string
  content_version: number
  payload: unknown
  created_at: string
}

export const PAGE_SIZE = 20
export const MESSAGE_MAX = 8000

export async function fetchConversation(id: string): Promise<{ id: string; title: string } | null> {
  const { data, error } = await supabase.from('conversations').select('id, title').eq('id', id).maybeSingle()
  if (error) throw error
  return data ? { id: String(data.id), title: String(data.title) } : null
}

export interface MessagesPage {
  items: ChatMessage[] // mais antiga primeiro
  hasMore: boolean
  oldest: number | null // cursor: sequence_no da mais antiga desta página
}

// Cursor por sequence_no: as `PAGE_SIZE` mais recentes com sequence_no menor que o cursor.
// Pede uma a mais para saber se há página anterior.
export async function fetchMessagesPage(conversationId: string, before: number | null): Promise<MessagesPage> {
  let query = supabase
    .from('messages')
    .select('id, role, sequence_no, content, content_version, payload, created_at')
    .eq('conversation_id', conversationId)
  if (before !== null) query = query.lt('sequence_no', before)
  const { data, error } = await query.order('sequence_no', { ascending: false }).limit(PAGE_SIZE + 1)
  if (error) throw error
  const rows = (data ?? []) as unknown as ChatMessage[]
  const hasMore = rows.length > PAGE_SIZE
  const items = rows.slice(0, PAGE_SIZE).reverse()
  return { items, hasMore, oldest: items.length > 0 ? items[0].sequence_no : null }
}

// --- Funções HTTP (Edge Functions) ---

export interface Selection {
  asset_ids: string[]
  metrics: string[]
}

export interface AgentRequest {
  message: string | null
  selection: Selection | null
}

// Controles que os testes ajustam; em produção ficam nos padrões.
export const chatConfig = {
  timeoutMs: 30_000,
  processingPauseMs: 3_000,
  processingMaxAttempts: 5,
}

// uuid v4. `crypto.randomUUID` só existe em contexto seguro; sem ele, usa getRandomValues.
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export type AgentOutcome =
  | { kind: 'completed' }
  | { kind: 'needs_selection'; code: string | null }
  | { kind: 'processing' }
  | { kind: 'http_error'; status: number; code: string | null }
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'bad_response' }
  | { kind: 'no_session' }

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Uma tentativa. Corpo: só request_id, conversation_id, message e selection. O user_id
// nunca vai (vem do JWT, no servidor), nem e-mail, nem carteira.
export async function postAgent(
  requestId: string,
  conversationId: string,
  request: AgentRequest,
  outer?: AbortSignal,
): Promise<AgentOutcome> {
  const token = await accessToken()
  if (!token) return { kind: 'no_session' }
  const body: Record<string, unknown> = { request_id: requestId, conversation_id: conversationId }
  if (request.message !== null) body.message = request.message
  if (request.selection !== null) body.selection = request.selection

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, chatConfig.timeoutMs)
  const onOuter = () => controller.abort()
  outer?.addEventListener('abort', onOuter)
  try {
    const response = await fetch(functionUrl('agent'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const json = await readJson(response)
    if (response.status === 202) return { kind: 'processing' }
    if (response.status === 200) {
      if (json?.status === 'completed') return { kind: 'completed' }
      if (json?.status === 'needs_selection') {
        const reason = json.reason
        const code =
          typeof reason === 'object' && reason !== null && typeof (reason as { code?: unknown }).code === 'string'
            ? (reason as { code: string }).code
            : null
        return { kind: 'needs_selection', code }
      }
      return { kind: 'bad_response' }
    }
    const error = json?.error
    const code =
      typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null
    return { kind: 'http_error', status: response.status, code }
  } catch {
    return timedOut ? { kind: 'timeout' } : { kind: 'network' }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

// Uma operação com o MESMO request_id: repete enquanto o servidor responde 202 (ainda
// processando), até `processingMaxAttempts`, com pausa entre as tentativas. `onWaiting` é
// chamado antes de cada pausa. Usado pelo chat e pela carteira.
export async function postAgentWithRetry(
  requestId: string,
  conversationId: string,
  request: AgentRequest,
  signal: AbortSignal,
  onWaiting: () => void = () => undefined,
): Promise<AgentOutcome | null> {
  let outcome = await postAgent(requestId, conversationId, request, signal)
  for (let attempt = 1; outcome.kind === 'processing' && attempt < chatConfig.processingMaxAttempts; attempt++) {
    if (signal.aborted) return null
    onWaiting()
    await sleep(chatConfig.processingPauseMs, signal)
    if (signal.aborted) return null
    outcome = await postAgent(requestId, conversationId, request, signal)
  }
  return signal.aborted ? null : outcome
}

export async function fetchCatalog(): Promise<Catalog> {
  const token = await accessToken()
  if (!token) throw new CatalogError(401)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), chatConfig.timeoutMs)
  try {
    const response = await fetch(functionUrl('catalog'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, apikey: publishableKey },
      signal: controller.signal,
    })
    if (!response.ok) throw new CatalogError(response.status)
    const catalog = readCatalog(await readJson(response))
    if (!catalog) throw new CatalogError(null)
    return catalog
  } catch (error) {
    if (error instanceof CatalogError) throw error
    throw new CatalogError(null)
  } finally {
    clearTimeout(timer)
  }
}

export class CatalogError extends Error {
  status: number | null
  constructor(status: number | null) {
    super('catalog')
    this.status = status
  }
}
