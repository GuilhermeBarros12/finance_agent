import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, NEXT, readTheme, THEME_KEY, ThemeContext, type Theme } from './useTheme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    applyTheme(theme)
    try {
      if (theme === 'sistema') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* armazenamento indisponível: o tema vale só nesta visita */
    }
  }, [theme])

  const cycle = useCallback(() => setTheme((t) => NEXT[t]), [])
  const value = useMemo(() => ({ theme, cycle }), [theme, cycle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
