/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { PERMISSION_LABEL, SOURCES } from './sources'

// O arquivo é lido do repositório (config/sources.yaml, sem rede): se o YAML mudar e o front
// não, o teste falha.
const yamlText = readFileSync(resolve(process.cwd(), '..', 'config', 'sources.yaml'), 'utf8') // o Vitest roda em frontend/

interface YamlSource {
  id?: string
  base_url?: string
  permission_status?: string
  reviewed_at?: string
  enabled?: string
}

// O arquivo é uma lista simples de chaves e valores; qualquer linha fora desse formato
// falha o teste em vez de ser ignorada.
function parseSources(text: string): YamlSource[] {
  const out: YamlSource[] = []
  let inSources = false
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (line === '' || line.trimStart().startsWith('#')) continue
    if (line === 'sources:') {
      inSources = true
      continue
    }
    if (!inSources) throw new Error(`linha inesperada: ${line}`)
    const item = /^ {2}- ([a-z_]+): (.*)$/.exec(line)
    const field = /^ {4}([a-z_]+): (.*)$/.exec(line)
    const match = item ?? field
    if (!match) throw new Error(`linha inesperada: ${line}`)
    if (item) out.push({})
    const value = match[2].replace(/^"(.*)"$/, '$1')
    ;(out[out.length - 1] as Record<string, string>)[match[1]] = value
  }
  return out
}

const yaml = parseSources(yamlText)

test('o YAML foi lido e tem fontes', () => {
  expect(yaml.length).toBeGreaterThanOrEqual(3)
})

test('os ids das fontes do front são os de config/sources.yaml', () => {
  expect(SOURCES.map((s) => s.id).sort()).toEqual(yaml.map((s) => s.id).sort())
})

test.each(SOURCES.map((s) => [s.id, s] as const))('%s: permissão, endereço, data e habilitação batem com o YAML', (id, source) => {
  const entry = yaml.find((s) => s.id === id)
  expect(entry).toBeTruthy()
  expect(source.permission).toBe(entry?.permission_status)
  expect(source.baseUrl).toBe(entry?.base_url)
  expect(source.reviewedAt).toBe(entry?.reviewed_at)
  expect(String(source.enabled)).toBe(entry?.enabled)
})

test('todo estado de permissão do YAML tem texto no front', () => {
  for (const entry of yaml) expect(Object.keys(PERMISSION_LABEL)).toContain(entry.permission_status)
})
