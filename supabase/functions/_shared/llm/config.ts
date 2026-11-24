// Configuração do LLM a partir do ambiente (README 12.3, 9.2). Função pura: recebe
// `get`, nunca lê Deno.env sozinha, e por isso os testes não dependem do ambiente.
// A chave (GROQ_API_KEY) só existe aqui e no cabeçalho Authorization da chamada.

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_DAILY_LIMIT = 200;
export const MAX_DAILY_LIMIT = 1_000_000;
export const QUOTA_PROVIDER = "groq";

// MOCK_LLM=true só vale nestes ambientes. Ambiente ausente, "staging", "production"
// ou qualquer outro valor recusa o mock: nunca cai em modo simulado fora do local.
export const MOCK_ALLOWED_ENVS = ["local", "test"] as const;

export type LlmConfig =
  | { mode: "mock" }
  | { mode: "disabled" }
  | { mode: "groq"; apiKey: string; model: string; dailyLimit: number };

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,99}$/;

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

export function resolveLlmConfig(
  get: (name: string) => string | undefined,
): LlmConfig {
  const mockRaw = clean(get("MOCK_LLM")).toLowerCase();
  if (mockRaw !== "" && mockRaw !== "true" && mockRaw !== "false") {
    throw new LlmConfigError('MOCK_LLM deve ser "true" ou "false".');
  }

  if (mockRaw === "true") {
    const appEnv = clean(get("APP_ENV")).toLowerCase();
    if (!(MOCK_ALLOWED_ENVS as readonly string[]).includes(appEnv)) {
      throw new LlmConfigError(
        "MOCK_LLM=true só é permitido com APP_ENV=local ou APP_ENV=test. " +
          "Em ambiente hospedado (staging, production) o modo simulado é recusado.",
      );
    }
    return { mode: "mock" };
  }

  const apiKey = clean(get("GROQ_API_KEY"));
  // Sem chave não há chamada: o agente responde com o seletor manual (LLM_DISABLED).
  if (apiKey === "") return { mode: "disabled" };

  const model = clean(get("GROQ_MODEL")) || DEFAULT_GROQ_MODEL;
  if (!MODEL_PATTERN.test(model)) {
    throw new LlmConfigError("GROQ_MODEL tem formato inválido.");
  }

  const limitRaw = clean(get("LLM_DAILY_LIMIT"));
  let dailyLimit = DEFAULT_DAILY_LIMIT;
  if (limitRaw !== "") {
    if (!/^\d{1,7}$/.test(limitRaw) || Number(limitRaw) > MAX_DAILY_LIMIT) {
      throw new LlmConfigError(
        `LLM_DAILY_LIMIT deve ser um inteiro entre 0 e ${MAX_DAILY_LIMIT}.`,
      );
    }
    dailyLimit = Number(limitRaw);
  }
  return { mode: "groq", apiKey, model, dailyLimit };
}
