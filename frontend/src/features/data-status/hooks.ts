import { useCallback, useRef, useState } from 'react'
import {
  buildExport,
  downloadText,
  ExportError,
  type ExportCounts,
  type ExportPart,
} from './exportData'

export type ExportState =
  | { kind: 'idle' }
  | { kind: 'running'; part: ExportPart; count: number }
  | { kind: 'done'; fileName: string; counts: ExportCounts; complete: boolean }
  | { kind: 'error'; part: ExportPart | null }

// Exportação: todas as partes ou nada. Só baixa o arquivo depois de ler tudo; qualquer falha
// vira erro (com nova tentativa) e nenhum arquivo é gerado.
export function useExport() {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })
  const busy = useRef(false)

  const run = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setState({ kind: 'running', part: 'conversations', count: 0 })
    try {
      const result = await buildExport((part, count) => setState({ kind: 'running', part, count }))
      downloadText(result.text, result.fileName)
      setState({ kind: 'done', fileName: result.fileName, counts: result.counts, complete: result.complete })
    } catch (error) {
      setState({ kind: 'error', part: error instanceof ExportError ? error.part : null })
    } finally {
      busy.current = false
    }
  }, [])

  return { state, run }
}
