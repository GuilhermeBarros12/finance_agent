import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { FreshnessBadge, StatusBadge } from './StatusBadge'
import { FRESHNESS_VISUAL, VALIDATION_VISUAL } from './visuals'
import type { FreshnessStatus, ValidationStatus } from './states'

const validation = Object.keys(VALIDATION_VISUAL) as ValidationStatus[]
const freshness = Object.keys(FRESHNESS_VISUAL) as FreshnessStatus[]

test('cobre os sete estados de validação e os quatro de atualização', () => {
  expect(validation.sort()).toEqual(['divergent', 'incomparable', 'invalid', 'missing', 'not_applicable', 'single_source', 'verified'])
  expect(freshness.sort()).toEqual(['expired', 'fresh', 'stale', 'unknown_reference_date'])
})

test('cada estado tem texto próprio, ícone e rótulo acessível (não depende só de cor)', () => {
  const labels = new Set<string>()
  for (const s of validation) {
    const { container, unmount } = render(<StatusBadge status={s} />)
    const text = VALIDATION_VISUAL[s].label
    labels.add(text)
    expect(screen.getByRole('img', { name: `Estado da validação: ${text}` })).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    unmount()
  }
  for (const s of freshness) {
    const { container, unmount } = render(<FreshnessBadge status={s} />)
    const text = FRESHNESS_VISUAL[s].label
    labels.add(text)
    expect(screen.getByRole('img', { name: `Estado da atualização: ${text}` })).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    unmount()
  }
  expect(labels.size).toBe(11)
})

test('o selo mantém o tamanho de texto do guia (text-nota) ao lado da cor', () => {
  for (const s of validation) {
    const { unmount } = render(<StatusBadge status={s} />)
    const el = screen.getByRole('img')
    expect(el.className).toContain('text-nota')
    expect(el.className).toMatch(/text-(verde|ambar|tinta|carmim)/)
    unmount()
  }
})
