import { Link } from 'react-router-dom'

// Rodapé de todas as telas (inclusive /entrar). Dentro do AppLayout ele fica acima da barra
// inferior fixa (o contêiner tem pb-14) e o scroll-padding do html cobre o foco por Tab.
export function LegalFooter() {
  return (
    <footer className="border-t border-borda px-4 py-3 text-nota text-tinta-suave">
      <p className="max-w-prose">As respostas deste sistema não são recomendação de investimento.</p>
      <Link to="/aviso-legal" className="inline-flex min-h-11 items-center underline">
        Aviso legal
      </Link>
    </footer>
  )
}
