// Datas de exibição em pt-BR, fuso de Brasília. Nunca devolve "hoje" nem a data atual no
// lugar de uma data ilegível: data inválida vira texto próprio.
export const INVALID_DATE_TEXT = 'data inválida'

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

const ISO_DATETIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/

export function formatDateTime(iso: string): string {
  if (!ISO_DATETIME.test(iso)) return INVALID_DATE_TEXT
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? INVALID_DATE_TEXT : dateTime.format(date)
}

// Data-base: "2026-09-18" é uma data de calendário, sem fuso. Troca só a ordem dos
// campos; passar por Date mudaria o dia em fusos negativos.
export function formatReference(value: string): string {
  const day = ISO_DATE.exec(value)
  if (day) return `${day[3]}/${day[2]}/${day[1]}`
  return formatDateTime(value)
}
