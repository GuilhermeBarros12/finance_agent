// Cliente Supabase falso, em memória. Só para testes: nunca abre rede.
// Imita o que as telas usam: auth, e um construtor de consultas com RLS simplificada
// (cada linha pertence a `user_id`; só o usuário da sessão a enxerga).
import { vi } from 'vitest'

type Row = Record<string, unknown>
type Op = 'select' | 'insert' | 'update' | 'delete'
type Result = { data: unknown; error: { message: string } | null }
type Listener = (event: string, session: unknown) => void

export interface FakeSession {
  user: { id: string }
  access_token: string
}

const BASE = Date.UTC(2026, 10, 16, 12, 0, 0)

// Mesma comparação para ordenar e para o cursor (`gt`): número com número, senão texto.
function compare(x: unknown, y: unknown): number {
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1
  const [a, b] = [String(x), String(y)]
  return a === b ? 0 : a < b ? -1 : 1
}

export function createFake() {
  const state = {
    session: null as FakeSession | null,
    tables: { conversations: [] as Row[], allowed_users: [] as Row[], messages: [] as Row[], portfolio_items: [] as Row[] } as Record<string, Row[]>,
    errors: {} as Record<string, string | undefined>,
    gate: null as Promise<void> | null, // segura as escritas
    readGate: null as Promise<void> | null, // segura as leituras de conversations
    messagesGate: null as Promise<void> | null, // segura as leituras de messages
    clock: 0,
    seq: 0,
    listeners: new Set<Listener>(),
    log: [] as { table: string; op: Op; payload?: unknown }[],
  }

  const tick = () => new Date(BASE + ++state.clock * 60_000).toISOString()

  class Query implements PromiseLike<Result> {
    private op: Op = 'select'
    private payload: Row = {}
    private filters: [string, unknown][] = []
    private orders: [string, boolean][] = []
    private lts: [string, number][] = []
    private gts: [string, unknown][] = []
    private columns: string[] | null = null
    private max: number | null = null
    private returning = false
    private mode: 'many' | 'maybe' = 'many'
    private table: string
    constructor(table: string) {
      this.table = table
    }

    select(columns?: string) {
      if (this.op !== 'select') this.returning = true
      // Como o PostgREST: só as colunas pedidas voltam (user_id não vem se não for pedido).
      else if (columns && columns.trim() !== '*') this.columns = columns.split(',').map((c) => c.trim())
      return this
    }
    insert(row: Row) {
      this.op = 'insert'
      this.payload = row
      return this
    }
    update(values: Row) {
      this.op = 'update'
      this.payload = values
      return this
    }
    delete() {
      this.op = 'delete'
      return this
    }
    eq(column: string, value: unknown) {
      this.filters.push([column, value])
      return this
    }
    lt(column: string, value: number) {
      this.lts.push([column, value])
      return this
    }
    gt(column: string, value: unknown) {
      this.gts.push([column, value])
      return this
    }
    limit(n: number) {
      this.max = n
      return this
    }
    order(column: string, options?: { ascending?: boolean }) {
      this.orders.push([column, options?.ascending !== false])
      return this
    }
    maybeSingle() {
      this.mode = 'maybe'
      return this
    }
    then<A, B>(ok?: (r: Result) => A | PromiseLike<A>, bad?: (e: unknown) => B | PromiseLike<B>) {
      return this.run().then(ok, bad)
    }

    private async run(): Promise<Result> {
      state.log.push({ table: this.table, op: this.op, payload: this.op === 'select' ? undefined : this.payload })
      if (this.op !== 'select' && state.gate) await state.gate
      if (this.op === 'select' && this.table === 'conversations' && state.readGate) await state.readGate
      if (this.op === 'select' && this.table === 'messages' && state.messagesGate) await state.messagesGate
      const failure = state.errors[`${this.table}.${this.op}`]
      if (failure) return { data: null, error: { message: failure } }
      const uid = state.session?.user.id
      const rows = state.tables[this.table] ?? []
      // is_allowed_user() nas políticas de conversations: revogado não vê nem escreve nada.
      const allowed = state.tables.allowed_users.some((r) => r.user_id === uid && r.enabled === true)
      const denied = (this.table === 'conversations' || this.table === 'messages' || this.table === 'portfolio_items') && !allowed
      const visible = (r: Row) => !denied && r.user_id === uid && this.filters.every(([c, v]) => r[c] === v) && this.lts.every(([c, v]) => (r[c] as number) < v) && this.gts.every(([c, v]) => compare(r[c], v) > 0)

      if (this.op === 'insert') {
        if (denied || this.payload.user_id !== uid) {
          return { data: null, error: { message: 'new row violates row-level security policy' } }
        }
        const row: Row = { id: `c-${++state.seq}`, title: 'Nova conversa', created_at: tick(), updated_at: tick(), ...this.payload }
        rows.push(row)
        return { data: this.returning ? [row] : null, error: null }
      }
      if (this.op === 'update') {
        const hit = rows.filter(visible)
        for (const r of hit) Object.assign(r, this.payload, { updated_at: tick() })
        return { data: this.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (this.op === 'delete') {
        const hit = rows.filter(visible)
        state.tables[this.table] = rows.filter((r) => !hit.includes(r))
        return { data: null, error: null }
      }
      let out = rows.filter(visible).map((r) => ({ ...r }))
      for (const [column, asc] of [...this.orders].reverse()) {
        out = out.sort((a, b) => {
          return compare(a[column], b[column]) * (asc ? 1 : -1)
        })
      }
      if (this.max !== null) out = out.slice(0, this.max)
      const columns = this.columns
      if (columns) out = out.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])))
      return { data: this.mode === 'maybe' ? (out[0] ?? null) : out, error: null }
    }
  }

  const emit = (event: string) => state.listeners.forEach((l) => l(event, state.session))

  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session }, error: null })),
      onAuthStateChange: vi.fn((listener: Listener) => {
        state.listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => state.listeners.delete(listener) } } }
      }),
      signInWithOAuth: vi.fn(async (_args: unknown) => ({ data: {}, error: null as { message: string } | null })),
      signOut: vi.fn(async () => {
        state.session = null
        emit('SIGNED_OUT')
        return { error: null }
      }),
    },
    from: (table: string) => new Query(table),
  }

  return {
    client,
    state,
    signIn(userId = 'u1') {
      state.session = { user: { id: userId }, access_token: `token-${userId}` }
    },
    allow(userId = 'u1', enabled = true) {
      state.tables.allowed_users.push({ user_id: userId, enabled })
    },
    revoke(userId = 'u1') {
      state.tables.allowed_users = state.tables.allowed_users.filter((r) => r.user_id !== userId)
    },
    setEnabled(userId: string, enabled: boolean) {
      for (const r of state.tables.allowed_users) if (r.user_id === userId) r.enabled = enabled
    },
    addConversation(title: string, userId = 'u1') {
      const row = { id: `c-${++state.seq}`, user_id: userId, title, created_at: tick(), updated_at: tick() }
      state.tables.conversations.push(row)
      return row
    },
    addMessage(conversationId: string, row: { role: 'user' | 'assistant'; sequence_no: number; content: string; payload?: unknown; content_version?: number }, userId = 'u1') {
      const message = { id: `m-${++state.seq}`, conversation_id: conversationId, user_id: userId, content_version: 1, payload: null, created_at: tick(), ...row }
      state.tables.messages.push(message)
      return message
    },
    addPortfolioItem(assetId: string, userId = 'u1') {
      const row = { id: `p-${++state.seq}`, user_id: userId, asset_id: assetId, created_at: tick() }
      state.tables.portfolio_items.push(row)
      return row
    },
    touch(id: string) {
      const row = state.tables.conversations.find((r) => r.id === id)
      if (row) row.updated_at = tick()
    },
    reset() {
      state.session = null
      state.tables = { conversations: [], allowed_users: [], messages: [], portfolio_items: [] }
      state.errors = {}
      state.gate = null
      state.readGate = null
      state.messagesGate = null
      state.log = []
      state.listeners.clear()
      client.auth.signInWithOAuth.mockClear()
      client.auth.signOut.mockClear()
    },
  }
}

export const fake = createFake()
