// Links de fonte: só https, sem credenciais nem porta, e só nos domínios das fontes da fatia
// (config/sources.yaml e data_sources). Qualquer outra coisa é descartada, e a tela mostra
// o nome da fonte sem link. O texto do servidor nunca vira HTML (sem innerHTML).
const ALLOWED_DOMAINS = ['fundamentus.com.br', 'statusinvest.com.br', 'brapi.dev']

export function safeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  const allowed = ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  return allowed ? url.href : null
}

const SOURCE_NAME: Record<string, string> = {
  fundamentus: 'Fundamentus',
  statusinvest: 'StatusInvest',
  brapi: 'brapi',
}

export const isKnownSource = (sourceId: string) => sourceId in SOURCE_NAME

// Nome para exibir. Código desconhecido aparece como veio (será renderizado como texto).
export function sourceName(sourceId: string): string {
  return SOURCE_NAME[sourceId] ?? sourceId
}
