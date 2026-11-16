// Validação do corpo de POST /agent (README 9.1, passo validate_request) e corpo
// canônico para o hash de idempotência (D16).
import { z } from "zod";
import { METRICS } from "../_shared/schemas.ts";

export const MAX_MESSAGE_CHARS = 8000;
export const MAX_ASSETS = 20;
export const MAX_BODY_BYTES = 64 * 1024;

const uuid = z.uuid().transform((s) => s.toLowerCase());
const assetId = z.string().regex(/^[A-Z0-9]{1,12}$/, {
  message: "ticker inválido (maiúsculas e dígitos, até 12 caracteres)",
});

function unique(items: string[]): boolean {
  return new Set(items).size === items.length;
}

export const agentRequestSchema = z.strictObject({
  request_id: uuid,
  conversation_id: uuid,
  message: z
    .string()
    .refine((s) => s.isWellFormed(), {
      message: "texto com substituto UTF-16 isolado",
    })
    // Conta caracteres (pontos de código), não unidades UTF-16.
    .refine((s) => [...s].length <= MAX_MESSAGE_CHARS, {
      message: `message excede ${MAX_MESSAGE_CHARS} caracteres`,
    })
    .nullish(),
  // Obrigatório nesta tarefa; a T19 passa a aceitar só `message`.
  selection: z.strictObject({
    asset_ids: z.array(assetId).min(1).max(MAX_ASSETS).refine(unique, {
      message: "asset_ids repetidos",
    }),
    metrics: z.array(z.enum(METRICS)).min(1).max(METRICS.length).refine(
      unique,
      { message: "metrics repetidas" },
    ),
  }),
});

export type AgentRequest = {
  request_id: string;
  conversation_id: string;
  // Texto digitado, ou null quando ausente ou só espaços.
  message: string | null;
  selection: { asset_ids: string[]; metrics: string[] };
};

export type ParseResult =
  | { ok: true; value: AgentRequest }
  | { ok: false; issues: { path: string; message: string }[] };

export function parseAgentRequest(input: unknown): ParseResult {
  const parsed = agentRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      // Só caminho e mensagem da regra: nunca devolve o valor recebido.
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const v = parsed.data;
  const message = v.message == null || v.message.trim() === ""
    ? null
    : v.message;
  return {
    ok: true,
    value: {
      request_id: v.request_id,
      conversation_id: v.conversation_id,
      message,
      selection: {
        asset_ids: v.selection.asset_ids,
        metrics: v.selection.metrics,
      },
    },
  };
}

// Corpo canônico: chaves em ordem fixa e valores normalizados. Dois corpos que
// significam o mesmo (ordem de chaves, message ausente ou nula) geram o mesmo texto.
// A ordem de asset_ids e de metrics faz parte do conteúdo: define a ordem da resposta.
export function canonicalBody(req: AgentRequest): string {
  return JSON.stringify({
    request_id: req.request_id,
    conversation_id: req.conversation_id,
    message: req.message,
    selection: {
      asset_ids: req.selection.asset_ids,
      metrics: req.selection.metrics,
    },
  });
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// UUID determinístico (formato v5) derivado de um texto. As duas mensagens de um
// turno usam ids derivados de (user_id, request_id): repetir a gravação não duplica.
export async function deriveUuid(
  seed: string,
  hash: (text: string) => Promise<string> = sha256Hex,
): Promise<string> {
  const h = await hash(seed);
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${
    h.slice(18, 20)
  }-${h.slice(20, 32)}`;
}
