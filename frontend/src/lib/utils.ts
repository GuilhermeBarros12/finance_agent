import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Os tamanhos de texto do guia (--text-* em index.css) precisam estar no grupo
// font-size; senão o twMerge os trata como cor e os remove perto de text-<cor>.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['nota', 'rotulo', 'subtitulo', 'tela', 'pagina'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
