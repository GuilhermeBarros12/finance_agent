// Saneamento do resumo de falhas (T18b). `failures` vem do manifesto do snapshot e é
// mostrado ao usuário: nada de URL (pode ter token), HTML, credencial ou string de
// conexão. Texto só, curto e em linha única.

export const MAX_REASON_LENGTH = 200;
const MAX_ID_LENGTH = 40;
const REMOVED = "[removido]";

export function sanitizeReason(raw: string): string {
  let text = raw;
  // HTML: tags completas e tag aberta até o fim; entidades e demais `<` `>`.
  text = text.replace(/<[^>]*>?/g, " ").replace(/&[a-z0-9#]{1,10};/gi, " ");
  text = text.replace(/[<>]/g, " ");
  // Qualquer URL ou string de conexão (esquema://...): pode conter token ou senha.
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, REMOVED);
  text = text.replace(/\bwww\.\S+/gi, REMOVED);
  // JWT, Bearer, chaves do Supabase e pares chave=valor sensíveis.
  text = text.replace(/\beyJ[\w-]+\.[\w-]+\.?[\w-]*/g, REMOVED);
  text = text.replace(/\bBearer\s+\S+/gi, REMOVED);
  text = text.replace(/\bsb_(?:secret|publishable)_\S+/gi, REMOVED);
  text = text.replace(
    /\b(?:[\w-]*(?:token|key|secret|password|passwd|pwd|credential|authorization|auth|signature|session|sid)[\w-]*)\s*[=:]\s*\S+/gi,
    REMOVED,
  );
  // Sequências longas sem espaço (hash, chave, base64) não são texto de motivo.
  text = text.replace(/[A-Za-z0-9+/_=-]{32,}/g, REMOVED);
  // Controle e espaços repetidos.
  // deno-lint-ignore no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (text === "") return "Falha sem detalhe disponível.";
  if (text.length > MAX_REASON_LENGTH) {
    text = text.slice(0, MAX_REASON_LENGTH - 1).trimEnd() + "…";
  }
  return text;
}

// Identificadores (ativo, fonte): só letras, dígitos e `._-`; o resto vira `_`.
export function sanitizeId(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.slice(0, MAX_ID_LENGTH);
}
