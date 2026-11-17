// Serviço de classificação usado pelo handler. Junta configuração, cota, mock e a chamada
// ao provedor. Devolve SEMPRE um resultado estruturado: a falha do LLM nunca derruba a
// requisição, ela vira `needs_selection` no endpoint (D5). O texto do LLM nunca chega ao
// usuário; só a seleção validada (tickers do universo e métricas do enum).
import { type LlmConfig, QUOTA_PROVIDER } from "./config.ts";
import { classifyIntent, type LlmFailureCode } from "./groq.ts";
import { validateClassification } from "./schema.ts";

// Limite de entrada para o classificador (a API aceita até 8.000 caracteres; o LLM não
// precisa disso para escolher tickers). Acima, não chamamos e o usuário usa o seletor.
export const MAX_LLM_INPUT_CHARS = 2_000;

// Classificação fixa do modo simulado (MOCK_LLM=true). Passa pela mesma validação.
export const MOCK_CLASSIFICATION = {
  intent: "compare",
  asset_ids: ["DEMO3"],
  metrics: ["dividend_yield"],
} as const;

export interface LlmSelection {
  asset_ids: string[];
  metrics: string[];
}

export type LlmOutcome =
  | { ok: true; source: "llm" | "mock"; selection: LlmSelection; calls: number }
  | { ok: false; code: LlmFailureCode; calls: number };

export interface LlmService {
  classify(message: string, universe: readonly string[]): Promise<LlmOutcome>;
}

export interface LlmServiceDeps {
  config: LlmConfig;
  fetch: typeof fetch;
  // Incrementa o contador global no banco; falso = limite diário atingido.
  consumeQuota: (provider: string, limit: number) => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export function createLlmService(deps: LlmServiceDeps): LlmService {
  return {
    async classify(message, universe) {
      const { config } = deps;
      if (config.mode === "disabled") {
        return { ok: false, code: "LLM_DISABLED", calls: 0 };
      }
      if ([...message].length > MAX_LLM_INPUT_CHARS) {
        return { ok: false, code: "LLM_INPUT_TOO_LONG", calls: 0 };
      }
      if (universe.length === 0) {
        return { ok: false, code: "LLM_NO_UNIVERSE", calls: 0 };
      }

      if (config.mode === "mock") {
        const checked = validateClassification(MOCK_CLASSIFICATION, universe);
        if (!checked.ok) {
          return { ok: false, code: "LLM_INVALID_OUTPUT", calls: 0 };
        }
        return {
          ok: true,
          source: "mock",
          selection: {
            asset_ids: checked.value.asset_ids,
            metrics: checked.value.metrics,
          },
          calls: 0,
        };
      }

      const result = await classifyIntent(message, {
        universe,
        apiKey: config.apiKey,
        model: config.model,
        fetch: deps.fetch,
        beforeCall: () => deps.consumeQuota(QUOTA_PROVIDER, config.dailyLimit),
        sleep: deps.sleep,
        timeoutMs: deps.timeoutMs,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        source: "llm",
        selection: {
          asset_ids: result.value.asset_ids,
          metrics: result.value.metrics,
        },
        calls: result.calls,
      };
    },
  };
}
