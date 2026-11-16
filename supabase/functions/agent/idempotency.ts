// Idempotência por (user_id, request_id) com hash do corpo (D16, README 15.6).
import type { NewRun, RunRepo, RunRow } from "./types.ts";

// Uma reserva parada há mais que isto é considerada expirada e pode ser retomada.
export const RESERVATION_TTL_MS = 3 * 60 * 1000;

export type Reservation =
  | { kind: "reserved"; runId: string }
  | { kind: "replay"; response: unknown }
  | { kind: "in_progress" }
  | { kind: "conflict" }
  | { kind: "conversation_missing" };

export async function reserveRun(
  repo: RunRepo,
  input: NewRun,
  now: Date,
): Promise<Reservation> {
  // Poucas voltas: a linha pode sumir entre o insert e a leitura (conversa apagada).
  for (let attempt = 0; attempt < 3; attempt++) {
    const inserted = await repo.insert(input);
    if (inserted.ok) return { kind: "reserved", runId: inserted.run.id };
    if (inserted.reason === "conversation_missing") {
      return { kind: "conversation_missing" };
    }

    const existing = await repo.find(input.user_id, input.request_id);
    if (!existing) continue;

    // Mesmo request_id com outro conteúdo é conflito em qualquer estado.
    if (existing.body_hash !== input.body_hash) return { kind: "conflict" };

    if (existing.status === "succeeded") {
      // Sem resposta gravada não há o que devolver; nunca inventamos uma.
      if (existing.response == null) {
        throw new Error("resposta gravada ausente");
      }
      return { kind: "replay", response: existing.response };
    }

    const staleBefore = new Date(now.getTime() - RESERVATION_TTL_MS)
      .toISOString();
    if (existing.status === "failed" || isExpired(existing, now)) {
      const from = existing.status === "failed" ? "failed" : "processing";
      const won = await repo.takeOver(existing.id, from, staleBefore);
      return won
        ? { kind: "reserved", runId: existing.id }
        : { kind: "in_progress" };
    }
    return { kind: "in_progress" };
  }
  return { kind: "in_progress" };
}

function isExpired(run: RunRow, now: Date): boolean {
  const updated = Date.parse(run.updated_at);
  if (Number.isNaN(updated)) return false; // sem data confiável, não retoma
  return now.getTime() - updated > RESERVATION_TTL_MS;
}
