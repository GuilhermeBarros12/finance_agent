import { Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SOURCES } from '@/features/data-status/sources'
import { ExternalLink } from './ExternalLink'
import { ScreenFrame } from './ScreenFrame'

// Texto da seção 23 do README (aviso legal), em português claro e fiel ao original, mais as
// fontes (README 18.2 e 18.3). Rota pública. Nada aqui vem do servidor.
const STATEMENT = 'As respostas deste sistema não são recomendação de investimento.'

export function LegalPage() {
  return (
    <ScreenFrame>
      <article className="mx-auto min-w-0 max-w-prose [overflow-wrap:break-word]">
        <p className="font-serif text-subtitulo font-semibold">Agente de Investimentos</p>
        <h1 className="mt-2 text-tela">Aviso legal</h1>

        <p role="note" className="mt-4 flex items-start gap-2 rounded-painel border-2 border-tinta p-4 font-medium">
          <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>{STATEMENT}</span>
        </p>

        <section aria-labelledby="finalidade" className="mt-6">
          <h2 id="finalidade" className="text-subtitulo">
            Finalidade
          </h2>
          <p className="mt-2">
            Este projeto tem finalidade educacional, experimental e informativa. Seu conteúdo{' '}
            <strong>
              não constitui recomendação de investimento, análise profissional individualizada, consultoria financeira,
              oferta ou solicitação de compra ou venda de ativos
            </strong>
            .
          </p>
        </section>

        <section aria-labelledby="limites" className="mt-6">
          <h2 id="limites" className="text-subtitulo">
            Limites da informação
          </h2>
          <p className="mt-2">
            As informações podem conter erros, atrasos, lacunas ou divergências entre fontes. Respostas geradas por
            inteligência artificial também podem ser incorretas. A validação entre fontes reduz determinados riscos de
            inconsistência, mas não garante a veracidade, a completude ou a adequação de um investimento.
          </p>
        </section>

        <section aria-labelledby="responsabilidade" className="mt-6">
          <h2 id="responsabilidade" className="text-subtitulo">
            Sua responsabilidade
          </h2>
          <p className="mt-2">
            Consulte as fontes originais e, quando necessário, profissionais devidamente habilitados. Decisões de
            investimento são de responsabilidade do usuário e devem considerar as suas circunstâncias e os riscos
            envolvidos.
          </p>
        </section>

        <section aria-labelledby="vinculos" className="mt-6">
          <h2 id="vinculos" className="text-subtitulo">
            Sem vínculo com terceiros
          </h2>
          <p className="mt-2">
            O projeto não possui afiliação, patrocínio ou certificação presumida da B3, do Tesouro Nacional, da UFG ou
            dos provedores mencionados. Nomes e marcas pertencem aos seus respectivos titulares.
          </p>
        </section>

        <section aria-labelledby="alcance" className="mt-6">
          <h2 id="alcance" className="text-subtitulo">
            Alcance deste aviso
          </h2>
          <p className="mt-2">
            Este aviso não substitui a avaliação das obrigações aplicáveis à operação e à eventual distribuição pública
            da aplicação.
          </p>
        </section>

        <section aria-labelledby="fontes" className="mt-6">
          <h2 id="fontes" className="text-subtitulo">
            Fontes dos dados
          </h2>
          <p className="mt-2">
            Os números vêm destas fontes. Cada número mostrado nas respostas traz a fonte e a data. Confira sempre no
            site de origem.
          </p>
          <ul className="mt-2">
            {SOURCES.map((source) => (
              <li key={source.id} className="flex flex-wrap items-baseline gap-x-2">
                <ExternalLink href={source.baseUrl}>{source.name}</ExternalLink>
                <span className="text-tinta-suave">{source.provides}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">
            Acesso público a uma página não equivale a autorização para coleta automatizada, armazenamento e
            redistribuição. Este projeto não é uma autorização concedida por essas fontes: valem os termos de uso de
            cada uma. Consulte, por exemplo, as{' '}
            <ExternalLink href="https://statusinvest.com.br/condicoes-de-uso">condições de uso do StatusInvest</ExternalLink>
            . O estado de permissão registrado de cada fonte aparece na tela{' '}
            <Link to="/dados" className="inline-flex min-h-11 items-center text-azul-caneta underline">
              Dados
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="ia" className="mt-6">
          <h2 id="ia" className="text-subtitulo">
            Uso de inteligência artificial
          </h2>
          <p className="mt-2">
            Quando o modo por inteligência artificial é usado, o texto da pergunta é processado por um serviço externo.
            A carteira, o e-mail, o identificador da conta, a sua sessão e as suas credenciais de acesso não são enviados a esse serviço.
          </p>
        </section>

        <p className="mt-6">
          <Link to="/" className="inline-flex min-h-11 items-center text-azul-caneta underline">
            Voltar ao início
          </Link>
        </p>
      </article>
    </ScreenFrame>
  )
}
