// Exportação dos dados do usuário (conversas, mensagens e carteira). Tudo acontece no
// navegador: lê do banco com o JWT do usuário (a RLS filtra) e monta o arquivo. Nenhuma
// chamada de rede além dessas leituras; nada é enviado a servidor.
import { fetchCatalog } from '@/features/chat/api'
import { supabase } from '@/lib/supabase'

export const FORMAT_VERSION = 1
export const REVOKE_DELAY_MS = 1000

// Controles que os testes ajustam. PostgREST limita a resposta (1000 linhas por padrão);
// a leitura segue por cursor até uma página vazia, então um limite menor no servidor não
// trunca em silêncio.
export const exportConfig = { pageSize: 500, maxPages: 400 }

export type ExportPart = 'conversations' | 'messages' | 'portfolio_items'

export const PART_LABEL: Record<ExportPart, string> = {
  conversations: 'as conversas',
  messages: 'as mensagens',
  portfolio_items: 'a carteira',
}

export class ExportError extends Error {
  part: ExportPart
  constructor(part: ExportPart) {
    super(`export:${part}`)
    this.part = part
  }
}

type Row = Record<string, unknown>

const COLUMNS: Record<ExportPart, string> = {
  conversations: 'id, title, created_at, updated_at',
  messages: 'id, conversation_id, role, sequence_no, content, content_version, payload, created_at',
  portfolio_items: 'id, asset_id, created_at',
}

export interface ExportCounts {
  conversations: number
  messages: number
  portfolio_items: number
}

export interface ExportResult {
  fileName: string
  counts: ExportCounts
  complete: boolean
  text: string
}

// Lê todas as linhas de uma tabela, por cursor de `id` (chave única), `pageSize` por vez, até
// uma página vazia. Falha de qualquer página derruba a leitura inteira.
async function readAll(part: ExportPart, onProgress: (count: number) => void): Promise<{ rows: Row[]; complete: boolean }> {
  const rows: Row[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  onProgress(0) // anuncia a parte que começa a ser lida
  for (let page = 0; page < exportConfig.maxPages; page += 1) {
    let query = supabase.from(part).select(COLUMNS[part]).order('id', { ascending: true }).limit(exportConfig.pageSize)
    if (cursor !== null) query = query.gt('id', cursor)
    const { data, error } = await query
    if (error || !Array.isArray(data)) throw new ExportError(part)
    if (data.length === 0) return { rows, complete: true }
    for (const raw of data as unknown[]) {
      const row = raw as Row
      const id = row?.id
      // Sem id de texto o cursor não avança; id repetido indica cursor quebrado. Em qualquer
      // caso, parar é melhor do que gerar um arquivo errado.
      if (typeof id !== 'string' || seen.has(id)) throw new ExportError(part)
      seen.add(id)
      rows.push(row)
      cursor = id
    }
    onProgress(rows.length)
  }
  return { rows, complete: false }
}

const byText = (a: unknown, b: unknown) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)

// AAAA-MM-DD no fuso de Brasília, como o resto das datas do app.
export function exportFileName(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
  return `exportacao-${parts}.json`
}

export type ExportProgress = (part: ExportPart, count: number) => void

export async function buildExport(onProgress: ExportProgress = () => undefined, now: () => Date = () => new Date()): Promise<ExportResult> {
  const conversations = await readAll('conversations', (n) => onProgress('conversations', n))
  const messages = await readAll('messages', (n) => onProgress('messages', n))
  const portfolio = await readAll('portfolio_items', (n) => onProgress('portfolio_items', n))
  // O catálogo só enriquece a carteira com o símbolo. Se falhar (rede, 401, formato), a
  // exportação segue sem ele: a carteira sai com o uuid e um aviso, nunca com símbolo inventado.
  const symbols = new Map<string, string>()
  let catalogOk = true
  try {
    const catalog = await fetchCatalog()
    for (const asset of catalog.assets) if (asset.id) symbols.set(asset.id, asset.asset_id)
  } catch {
    catalogOk = false
  }
  const at = now()

  const complete = conversations.complete && messages.complete && portfolio.complete
  const avisos: string[] = []
  const partial = (part: ExportPart, ok: boolean) => {
    if (!ok) avisos.push(`Limite de segurança de leitura atingido em ${PART_LABEL[part]}: o arquivo pode estar incompleto.`)
  }
  partial('conversations', conversations.complete)
  partial('messages', messages.complete)
  partial('portfolio_items', portfolio.complete)

  // Ordem estável. Os valores de `payload` são copiados como vieram (texto), sem conversão.
  conversations.rows.sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))
  messages.rows.sort(
    (a, b) => byText(a.conversation_id, b.conversation_id) || (Number(a.sequence_no) - Number(b.sequence_no)),
  )
  portfolio.rows.sort((a, b) => byText(a.created_at, b.created_at) || byText(a.id, b.id))

  const unresolved = portfolio.rows.filter((row) => !symbols.has(String(row.asset_id).toLowerCase()))
  const portfolioOut = portfolio.rows.map((row) => {
    const symbol = symbols.get(String(row.asset_id).toLowerCase())
    return symbol === undefined ? row : { ...row, symbol }
  })
  if (portfolio.rows.length > 0) {
    if (!catalogOk) {
      avisos.push('Não foi possível ler o catálogo: a carteira saiu só com o identificador interno (asset_id), sem o símbolo.')
    } else if (unresolved.length > 0) {
      avisos.push(
        `${unresolved.length} ${unresolved.length === 1 ? 'item da carteira não consta' : 'itens da carteira não constam'} no catálogo: ${unresolved.length === 1 ? 'saiu' : 'saíram'} só com o identificador interno (asset_id), sem o símbolo.`,
      )
    }
  }

  const file = {
    format_version: FORMAT_VERSION,
    exported_at: at.toISOString(),
    complete,
    notas: [
      'A carteira traz o identificador interno de cada ação (asset_id). O símbolo (symbol) é acrescentado quando o catálogo está disponível e conhece o identificador; sem ele, o item sai só com o identificador.',
      'Os valores financeiros dentro de messages[].payload são textos (strings), exatamente como foram gravados. Nenhum foi convertido.',
      'Este arquivo foi montado no navegador, com os dados lidos pela sua conta. Não contém e-mail, identificador da conta nem chaves.',
    ],
    avisos,
    conversations: conversations.rows,
    messages: messages.rows,
    portfolio_items: portfolioOut,
  }

  return {
    fileName: exportFileName(at),
    counts: {
      conversations: conversations.rows.length,
      messages: messages.rows.length,
      portfolio_items: portfolio.rows.length,
    },
    complete,
    text: JSON.stringify(file, null, 2),
  }
}

// Baixa o texto como arquivo, no navegador: Blob, URL temporária, <a download>. A URL é
// revogada pouco depois do clique.
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    link.style.display = 'none'
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    // Revoga depois de um instante: Firefox e Safari podem precisar da URL viva logo após o clique.
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
  }
}
