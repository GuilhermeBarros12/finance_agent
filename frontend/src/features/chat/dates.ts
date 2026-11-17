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

// Idade corrida do lote, só a partir de datas (`collected_at` e um "agora" injetável): é uma
// diferença de tempo, sem valor de mercado. Não é o estado de atualização, que o servidor
// calcula em dias úteis. Coleta no futuro além da tolerância ou data ilegível nunca viram
// "hoje" nem zero.
export const AGE_CLOCK_SKEW_MS = 5 * 60 * 1000
export const AGE_FUTURE_TEXT = 'data de coleta no futuro'
export const AGE_UNAVAILABLE_TEXT = 'idade indisponível'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function formatAge(collectedIso: string, now: Date): string {
  if (!ISO_DATETIME.test(collectedIso)) return AGE_UNAVAILABLE_TEXT
  const collected = new Date(collectedIso).getTime()
  const current = now.getTime()
  if (Number.isNaN(collected) || Number.isNaN(current)) return AGE_UNAVAILABLE_TEXT
  const diff = current - collected
  if (diff < -AGE_CLOCK_SKEW_MS) return AGE_FUTURE_TEXT
  if (diff < AGE_CLOCK_SKEW_MS) return 'agora há pouco'
  if (diff < HOUR_MS) return 'há menos de 1 hora'
  if (diff < DAY_MS) {
    const hours = Math.floor(diff / HOUR_MS)
    return `há ${hours} ${hours === 1 ? 'hora' : 'horas'}`
  }
  const days = Math.floor(diff / DAY_MS)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}
