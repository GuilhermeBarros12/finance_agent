import { Moon, Monitor, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type Theme } from './useTheme'

const LABEL: Record<Theme, string> = {
  sistema: 'Tema: seguir o sistema',
  claro: 'Tema: claro',
  escuro: 'Tema: escuro',
}
const ICON = { sistema: Monitor, claro: Sun, escuro: Moon }

export function ThemeToggle() {
  const { theme, cycle } = useTheme()
  const Icon = ICON[theme]
  return (
    <Button variant="ghost" onClick={cycle} aria-label={`${LABEL[theme]}. Alternar tema`} className="px-3">
      <Icon aria-hidden="true" className="size-5" />
      <span className="text-nota">{LABEL[theme].replace('Tema: ', '')}</span>
    </Button>
  )
}
