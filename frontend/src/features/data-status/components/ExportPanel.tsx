import { CalendarClock, CheckCircle2, Download, Loader2, TriangleAlert } from 'lucide-react'
import { ErrorState } from '@/components/state'
import { Button } from '@/components/ui/button'
import { PART_LABEL } from '../exportData'
import { useExport } from '../hooks'

export function ExportPanel() {
  const { state, run } = useExport()
  const running = state.kind === 'running'
  return (
    <section aria-labelledby="exportar-titulo" className="min-w-0">
      <h2 id="exportar-titulo" className="text-subtitulo">
        Exportar meus dados
      </h2>
      <p className="mt-2 max-w-prose text-tinta-suave">
        Baixa um arquivo JSON com as suas conversas, as mensagens (com a evidência de cada resposta) e a carteira. O arquivo
        é montado neste navegador e nada é enviado a nenhum servidor. Na carteira, cada ação sai com o identificador
        interno, não com o símbolo.
      </p>
      <p className="mt-2 flex max-w-prose items-start gap-2">
        <CalendarClock aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <span>Guarde uma cópia por semana, fora do repositório. O arquivo tem dados pessoais.</span>
      </p>
      <div className="mt-4">
        <Button variant="outline" aria-disabled={running} onClick={() => void run()}>
          <Download aria-hidden="true" className="size-5" />
          Exportar meus dados
        </Button>
      </div>
      <div aria-live="polite" className="mt-4 min-w-0">
        {running ? (
          <p className="flex items-start gap-2 text-tinta-suave">
            <Loader2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 animate-spin motion-reduce:animate-none" />
            <span>
              Exportando: lendo {PART_LABEL[state.part]}
              {state.count > 0 ? ` (${state.count} lidas até agora)` : ''}...
            </span>
          </p>
        ) : null}
        {state.kind === 'done' ? (
          <div className="space-y-2">
            <p className="flex items-start gap-2">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                Exportação concluída. Arquivo baixado: {state.fileName} ({state.counts.conversations} conversas,{' '}
                {state.counts.messages} mensagens, {state.counts.portfolio_items} itens da carteira).
              </span>
            </p>
            {state.complete ? null : (
              <p className="flex items-start gap-2 font-medium text-ambar-alerta">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
                <span>
                  O limite de segurança de leitura foi atingido: o arquivo pode estar incompleto. O próprio arquivo traz
                  este aviso.
                </span>
              </p>
            )}
          </div>
        ) : null}
        {state.kind === 'error' ? (
          <ErrorState
            title="Não foi possível exportar"
            message={`${state.part ? `Falhou a leitura d${PART_LABEL[state.part]}.` : 'A exportação falhou.'} Nenhum arquivo foi baixado: a exportação só é feita com todas as partes. Tente de novo.`}
            onRetry={() => void run()}
          />
        ) : null}
      </div>
    </section>
  )
}
