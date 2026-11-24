import { expect, test } from 'vitest'
import { readCatalog } from '@/features/chat/contracts'
import { DEMO3_UUID, catalogBody } from '@/features/chat/fixtures'
import { catalogIds, resolveEntries, titleForRefresh } from './resolve'

test('o catálogo lê o id de cada ativo como campo opcional (ausente ou malformado vira undefined)', () => {
  const body = catalogBody() as { assets: Record<string, unknown>[] }
  body.assets[1] = { ...body.assets[1], id: 'TEST4' }
  delete body.assets[2].id
  const catalog = readCatalog(body)
  expect(catalog?.assets.map((a) => a.id)).toEqual([DEMO3_UUID, undefined, undefined])
  expect(catalogIds(catalog!)).toEqual({ kind: 'ok', assets: [{ id: DEMO3_UUID, symbol: 'DEMO3', name: 'Demo S.A. (fictícia)' }] })
})

test('catálogo com ativos e nenhum id é "no_ids"; catálogo vazio é válido', () => {
  const body = catalogBody() as { assets: Record<string, unknown>[] }
  body.assets = body.assets.map(({ id: _id, ...rest }) => rest)
  expect(catalogIds(readCatalog(body)!)).toEqual({ kind: 'no_ids' })
  expect(catalogIds(readCatalog({ ...catalogBody(), assets: [] })!)).toEqual({ kind: 'ok', assets: [] })
})

test('o cruzamento só compara texto: uuid conhecido vira símbolo e nome, desconhecido fica sem símbolo', () => {
  const entries = resolveEntries(
    [{ id: 'p1', asset_id: DEMO3_UUID }, { id: 'p2', asset_id: '99999999-9999-4999-8999-999999999999' }],
    [{ id: DEMO3_UUID, symbol: 'DEMO3', name: 'Demo' }],
  )
  expect(entries).toEqual([
    { rowId: 'p1', assetUuid: DEMO3_UUID, found: true, symbol: 'DEMO3', name: 'Demo' },
    { rowId: 'p2', assetUuid: '99999999-9999-4999-8999-999999999999', found: false },
  ])
  expect(resolveEntries([{ id: 'p1', asset_id: DEMO3_UUID }], null)[0].found).toBe(false)
})

test('título da conversa usa a data de Brasília e cabe no limite de 200', () => {
  expect(titleForRefresh(new Date('2026-11-17T01:30:00Z'))).toBe('Carteira — 16/11/2026')
})
