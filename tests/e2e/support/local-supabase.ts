// Lê, em tempo de execução, as credenciais do Supabase LOCAL da CLI (`supabase status`).
// Nada disso é gravado em arquivo: os valores existem só na memória do processo e no
// ambiente dos processos filhos (gateway e servidor de desenvolvimento). A chave
// administrativa local nunca vai para o navegador.
import { execFileSync } from 'node:child_process'

export interface LocalSupabase {
  apiUrl: string
  anonKey: string
  adminKey: string
}

const CACHE = 'E2E_LOCAL_SUPABASE'

function parse(text: string): LocalSupabase {
  // A CLI pode imprimir avisos antes do JSON; pega o objeto.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  const json = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  const apiUrl = json.API_URL
  const anonKey = json.ANON_KEY
  const adminKey = json.SERVICE_ROLE_KEY
  if (typeof apiUrl !== 'string' || typeof anonKey !== 'string' || typeof adminKey !== 'string') {
    throw new Error('`supabase status` não trouxe API_URL, ANON_KEY e a chave administrativa local. O Supabase local está no ar?')
  }
  return { apiUrl, anonKey, adminKey }
}

export function readLocalSupabase(): LocalSupabase {
  const cached = process.env[CACHE]
  if (cached) return JSON.parse(cached) as LocalSupabase
  const text = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 60_000,
  })
  const value = parse(text)
  // Os workers do Playwright herdam o ambiente: o status é lido uma vez só.
  process.env[CACHE] = JSON.stringify(value)
  return value
}

// Endereços da bancada de teste (fixos, só locais).
export const GATEWAY_PORT = 54331
export const FRONT_PORT = 5173
export const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
export const FRONT_URL = `http://127.0.0.1:${FRONT_PORT}`
