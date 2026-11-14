import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ThemeProvider } from './ThemeProvider'
import { ThemeToggle } from './ThemeToggle'
import { applyStoredTheme } from './useTheme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-tema')
})

test('tema guardado vale antes de qualquer componente montar (rotas públicas)', () => {
  localStorage.setItem('tema', 'escuro')
  applyStoredTheme()
  expect(document.documentElement.getAttribute('data-tema')).toBe('escuro')
})

test('sem valor guardado, segue o sistema', () => {
  applyStoredTheme()
  expect(document.documentElement.hasAttribute('data-tema')).toBe(false)
})

test('dois alternadores compartilham o mesmo estado', () => {
  render(
    <ThemeProvider>
      <ThemeToggle />
      <ThemeToggle />
    </ThemeProvider>,
  )
  const buttons = screen.getAllByRole('button')
  fireEvent.click(buttons[0])
  for (const b of screen.getAllByRole('button')) expect(b.getAttribute('aria-label')).toContain('Tema: claro')
  expect(document.documentElement.getAttribute('data-tema')).toBe('claro')
  expect(localStorage.getItem('tema')).toBe('claro')
})
