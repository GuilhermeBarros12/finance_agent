import type { Catalog } from '@/features/chat/contracts'
import type { PortfolioRow } from './api'

export type PortfolioEntry =
  | { rowId: string; assetUuid: string; found: true; symbol: string; name: string }
  | { rowId: string; assetUuid: string; found: false }

export type CatalogIds = { kind: 'ok'; assets: { id: string; symbol: string; name: string }[] } | { kind: 'no_ids' }

// O catálogo só serve à carteira se trouxer o uuid dos ativos. Lista vazia é válida (nada a
// adicionar); lista com ativos e nenhum uuid é backend antigo: nada é adivinhado.
export function catalogIds(catalog: Catalog): CatalogIds {
  const assets = catalog.assets.flatMap((a) => (a.id ? [{ id: a.id, symbol: a.asset_id, name: a.name }] : []))
  if (catalog.assets.length > 0 && assets.length === 0) return { kind: 'no_ids' }
  return { kind: 'ok', assets }
}

// Cruza a carteira (uuid) com o catálogo (uuid -> símbolo e nome). Só igualdade de texto.
export function resolveEntries(rows: PortfolioRow[], assets: { id: string; symbol: string; name: string }[] | null): PortfolioEntry[] {
  const byId = new Map((assets ?? []).map((a) => [a.id, a]))
  return rows.map((row) => {
    const asset = byId.get(row.asset_id)
    return asset
      ? { rowId: row.id, assetUuid: row.asset_id, found: true, symbol: asset.symbol, name: asset.name }
      : { rowId: row.id, assetUuid: row.asset_id, found: false }
  })
}

export function titleForRefresh(now: Date): string {
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(now)
  return `Carteira — ${date}`
}
