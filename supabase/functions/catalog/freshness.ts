// Frescor do snapshot (ADR 0001, D20). Reprodução em TypeScript da regra do motor de
// validação (collector/src/collector/validation/engine.py, `compute_freshness`):
// dias úteis seg-sex em (dia de `collected_at`, dia de `now`], no fuso de Brasília
// (UTC-3 fixo, sem horário de verão); mais de 1 dia útil é `stale`, mais de 5 é
// `expired`. Feriados não são considerados (igual ao motor). `now` é sempre injetado.
// Coleta mais de 5 minutos à frente de `now`: `unknown_reference_date` (nunca "fresh").

export type SnapshotFreshness =
  | "fresh"
  | "stale"
  | "expired"
  | "unknown_reference_date";

export const STALE_AFTER_BUSINESS_DAYS = 1;
export const EXPIRED_AFTER_BUSINESS_DAYS = 5;
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

// Número do dia (desde 1970-01-01) no calendário de Brasília.
function brtDayNumber(d: Date): number {
  return Math.floor((d.getTime() + BRT_OFFSET_MS) / DAY_MS);
}

// 1970-01-01 foi quinta-feira: (dia + 3) % 7 dá 0 = segunda ... 6 = domingo.
function isBusinessDay(dayNumber: number): boolean {
  return ((dayNumber + 3) % 7 + 7) % 7 < 5;
}

// Dias úteis em (start, end]. Zero se end <= start.
export function businessDaysBetween(start: Date, end: Date): number {
  const from = brtDayNumber(start);
  const to = brtDayNumber(end);
  let days = 0;
  for (let day = from + 1; day <= to; day++) {
    if (isBusinessDay(day)) days++;
  }
  return days;
}

export function computeFreshness(
  collectedAt: Date,
  now: Date,
): SnapshotFreshness {
  if (
    Number.isNaN(collectedAt.getTime()) || Number.isNaN(now.getTime())
  ) {
    throw new Error("data inválida no cálculo de frescor");
  }
  if (collectedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    return "unknown_reference_date";
  }
  const elapsed = businessDaysBetween(collectedAt, now);
  if (elapsed > EXPIRED_AFTER_BUSINESS_DAYS) return "expired";
  if (elapsed > STALE_AFTER_BUSINESS_DAYS) return "stale";
  return "fresh";
}
