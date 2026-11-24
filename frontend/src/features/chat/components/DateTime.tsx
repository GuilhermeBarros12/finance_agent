import { formatDateTime } from '../dates'

// Data e hora: cada parte não quebra, mas a frase pode quebrar entre a data e a hora
// (a largura mínima cai de ~17 para ~10 caracteres).
export function DateTime({ iso }: { iso: string }) {
  const text = formatDateTime(iso)
  const match = /^(.*), ([0-9]{2}:[0-9]{2})$/.exec(text)
  if (!match) return <span className="whitespace-nowrap">{text}</span>
  return (
    <>
      <span className="whitespace-nowrap">{match[1]},</span> <span className="whitespace-nowrap">{match[2]}</span>
    </>
  )
}
