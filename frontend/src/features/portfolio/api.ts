import { UUID } from '@/features/chat/contracts'
import { supabase } from '@/lib/supabase'

// A carteira guarda só o símbolo da ação: portfolio_items tem (user_id, asset_id uuid), e o
// grant de insert do navegador cobre só essas duas colunas. Nada de quantidade, preço,
// valor, data de compra ou nota. Este módulo NUNCA é importado pelo fluxo de `message`
// (classificador): um teste varre os imports.

// Mesmo limite do backend por pedido (`MAX_ASSETS` em supabase/functions/agent/request.ts).
export const PORTFOLIO_MAX = 20

export interface PortfolioRow {
  id: string
  asset_id: string // uuid de assets.id
}

export type AddFailure = 'duplicate' | 'unknown_asset' | 'denied' | 'invalid' | 'other'

export class PortfolioWriteError extends Error {
  kind: AddFailure
  constructor(kind: AddFailure) {
    super(`portfolio:${kind}`)
    this.kind = kind
  }
}

export async function listPortfolio(): Promise<PortfolioRow[]> {
  const { data, error } = await supabase
    .from('portfolio_items')
    .select('id, asset_id')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as unknown as { id: unknown; asset_id: unknown }[]
  return rows.map((row) => {
    // Linha sem uuid legível é dado inconsistente: a leitura falha, não vira lista parcial.
    if (typeof row.id !== 'string' || typeof row.asset_id !== 'string') throw new Error('portfolio: linha ilegível')
    return { id: row.id, asset_id: row.asset_id.toLowerCase() }
  })
}

// Insere (user_id, asset_id) com o id da SESSÃO e o uuid do ativo. A barreira é a RLS
// (user_id = auth.uid() e is_allowed_user()). Símbolo no lugar do uuid é recusado aqui.
export async function addPortfolioItem(userId: string, assetUuid: string): Promise<void> {
  if (!UUID.test(assetUuid)) throw new PortfolioWriteError('invalid')
  const { error } = await supabase.from('portfolio_items').insert({ user_id: userId, asset_id: assetUuid })
  if (!error) return
  const code = (error as { code?: string }).code
  if (code === '23505') throw new PortfolioWriteError('duplicate')
  if (code === '23503') throw new PortfolioWriteError('unknown_asset')
  if (code === '42501') throw new PortfolioWriteError('denied')
  throw new PortfolioWriteError('other')
}

export async function removePortfolioItem(rowId: string): Promise<void> {
  const { error } = await supabase.from('portfolio_items').delete().eq('id', rowId)
  if (error) throw error
}
