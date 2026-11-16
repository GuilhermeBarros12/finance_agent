// Erros estruturados das Edge Functions (README 15.6; T18 e T18b). Toda falha prevista vira
// `{ "error": { "code", "message", "details"? } }` com o status HTTP do código.

export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "REQUEST_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_ASSET"
  | "INTERNAL_ERROR"
  | "DATA_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE";

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  invalidRequest: (message: string, details?: unknown) =>
    new AppError(400, "INVALID_REQUEST", message, details),
  unauthenticated: () =>
    new AppError(
      401,
      "UNAUTHENTICATED",
      "Sessão ausente, inválida ou expirada. Entre novamente.",
    ),
  accessDenied: () =>
    new AppError(
      403,
      "ACCESS_DENIED",
      "Esta conta não tem autorização para usar o agente.",
    ),
  notFound: () => new AppError(404, "NOT_FOUND", "Conversa não encontrada."),
  methodNotAllowed: (allowed = "POST") =>
    new AppError(405, "METHOD_NOT_ALLOWED", `Use ${allowed}.`),
  conflict: () =>
    new AppError(
      409,
      "REQUEST_CONFLICT",
      "Este request_id já foi usado com um conteúdo diferente.",
    ),
  tooLarge: () =>
    new AppError(
      413,
      "PAYLOAD_TOO_LARGE",
      "O corpo da requisição excede o limite de tamanho.",
    ),
  unsupportedAsset: (assetIds: string[]) =>
    new AppError(
      422,
      "UNSUPPORTED_ASSET",
      "Há ativos fora do universo suportado.",
      { asset_ids: assetIds },
    ),
  dataUnavailable: () =>
    new AppError(
      503,
      "DATA_UNAVAILABLE",
      "Não há um conjunto de dados publicado disponível.",
    ),
  serviceUnavailable: () =>
    new AppError(
      503,
      "SERVICE_UNAVAILABLE",
      "Serviço temporariamente indisponível. Tente novamente.",
    ),
  internal: () =>
    new AppError(500, "INTERNAL_ERROR", "Erro interno. Tente novamente."),
};

export function errorBody(err: AppError): Record<string, unknown> {
  const error: Record<string, unknown> = {
    code: err.code,
    message: err.message,
  };
  if (err.details !== undefined) error.details = err.details;
  return { error };
}
