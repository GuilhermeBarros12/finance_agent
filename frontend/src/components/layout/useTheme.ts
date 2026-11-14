import { createContext, useContext } from 'react'

export type Theme = 'sistema' | 'claro' | 'escuro'
export const THEME_KEY = 'tema'

export const NEXT: Record<Theme, Theme> = { sistema: 'claro', claro: 'escuro', escuro: 'sistema' }

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'claro' || v === 'escuro' ? v : 'sistema'
  } catch {
    return 'sistema'
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'sistema') root.removeAttribute('data-tema')
  else root.setAttribute('data-tema', theme)
}

/** Aplica o tema guardado; chamado em main.tsx antes do render, vale para rotas públicas. */
export function applyStoredTheme() {
  applyTheme(readTheme())
}

export interface ThemeContextValue {
  theme: Theme
  cycle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme precisa estar dentro de ThemeProvider')
  return ctx
}
