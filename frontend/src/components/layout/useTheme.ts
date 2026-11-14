import { useCallback, useEffect, useState } from 'react'

export type Theme = 'sistema' | 'claro' | 'escuro'
const KEY = 'tema'

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY)
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

const NEXT: Record<Theme, Theme> = { sistema: 'claro', claro: 'escuro', escuro: 'sistema' }

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    applyTheme(theme)
    try {
      if (theme === 'sistema') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, theme)
    } catch {
      /* armazenamento indisponível: o tema vale só nesta visita */
    }
  }, [theme])

  const cycle = useCallback(() => setTheme((t) => NEXT[t]), [])
  return { theme, cycle }
}
