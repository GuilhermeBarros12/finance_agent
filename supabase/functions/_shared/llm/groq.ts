// Chamada ao provedor (Groq, API compatível com OpenAI) só para classificar a intenção
// (T19, D4). Sem Gemini e sem roteador de fallback (D6). `fetch` é INJETADO e obrigatório:
// nenhum teste usa a rede real. Nada daqui vaza chave, URL, corpo do provedor ou texto do
// usuário em erro ou log: toda falha vira um código estável.
import {
  buildPrompt,
  type Classification,
  validateClassification,
} from "./schema.ts";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const MAX_ATTEMPTS = 2; // no máximo 2 chamadas por requisição
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_BACKOFF_MS = 500;
export const MAX_RETRY_AFTER_MS = 5_000; // teto: acima disto, não esperamos nem tentamos de novo
export const MAX_RESPONSE_BYTES = 32 * 1024;
export const MAX_OUTPUT_TOKENS = 1024;

export type LlmFailureCode =
  | "LLM_INVALID_OUTPUT"
  | "LLM_UNSUPPORTED"
  | "LLM_QUOTA_EXHAUSTED"
  | "LLM_QUOTA_UNAVAILABLE"
  | "LLM_PROVIDER_ERROR"
  | "LLM_TIMEOUT"
  | "LLM_DISABLED"
  | "LLM_INPUT_TOO_LONG"
  | "LLM_NO_UNIVERSE";

export interface ClassifyOptions {
  universe: readonly string[];
  apiKey: string;
  model: string;
  // Obrigatório e sem padrão: nenhum caminho cai no fetch real sem querer.
  fetch: typeof fetch;
  // Consome 1 unidade da cota global ANTES de cada chamada. Falso = esgotada.
  beforeCall: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  backoffMs?: number;
  maxRetryAfterMs?: number;
  maxResponseBytes?: number;
}

export type ClassifyResult =
  | { ok: true; value: Classification; calls: number }
  | { ok: false; code: LlmFailureCode; calls: number };

type Attempt =
  | { kind: "ok"; text: string }
  | { kind: "invalid" }
  | { kind: "timeout" }
  | { kind: "transient"; retryAfterMs: number | null }
  | { kind: "fatal" };

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function classifyIntent(
  message: string,
  opts: ClassifyOptions,
): Promise<ClassifyResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const prompt = buildPrompt(message, opts.universe);
  const body = JSON.stringify({
    model: opts.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: 0,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
  });

  let calls = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let allowed: boolean;
    try {
      allowed = await opts.beforeCall();
    } catch {
      // Sem conseguir contar, não chamamos (falha fechada).
      return { ok: false, code: "LLM_QUOTA_UNAVAILABLE", calls };
    }
    if (!allowed) return { ok: false, code: "LLM_QUOTA_EXHAUSTED", calls };

    calls++;
    const result = await callOnce(body, opts);
    switch (result.kind) {
      case "ok":
        return finish(result.text, opts.universe, calls);
      case "invalid":
        return { ok: false, code: "LLM_INVALID_OUTPUT", calls };
      case "timeout":
        // Timeout não é repetido: o prazo total já foi gasto.
        return { ok: false, code: "LLM_TIMEOUT", calls };
      case "fatal":
        return { ok: false, code: "LLM_PROVIDER_ERROR", calls };
      case "transient": {
        if (attempt >= MAX_ATTEMPTS) {
          return { ok: false, code: "LLM_PROVIDER_ERROR", calls };
        }
        const cap = opts.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS;
        const wait = result.retryAfterMs ?? opts.backoffMs ??
          DEFAULT_BACKOFF_MS;
        // Retry-After acima do teto: o provedor pede mais do que podemos esperar.
        if (wait > cap) return { ok: false, code: "LLM_PROVIDER_ERROR", calls };
        await sleep(wait);
      }
    }
  }
  return { ok: false, code: "LLM_PROVIDER_ERROR", calls };
}

function finish(
  text: string,
  universe: readonly string[],
  calls: number,
): ClassifyResult {
  // Extração ESTRITA: o texto inteiro precisa ser um objeto JSON. Cerca de markdown ou
  // texto antes/depois invalida a resposta; nada é "garimpado" de dentro do texto.
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "LLM_INVALID_OUTPUT", calls };
  }
  const checked = validateClassification(raw, universe);
  if (!checked.ok) return { ok: false, code: "LLM_INVALID_OUTPUT", calls };
  if (checked.value.intent === "unsupported") {
    return { ok: false, code: "LLM_UNSUPPORTED", calls };
  }
  return { ok: true, value: checked.value, calls };
}

async function callOnce(body: string, opts: ClassifyOptions): Promise<Attempt> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await opts.fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body,
        signal: controller.signal,
        redirect: "error",
      });
    } catch {
      // Erro de rede (sem detalhe: a mensagem poderia trazer URL).
      return timedOut
        ? { kind: "timeout" }
        : { kind: "transient", retryAfterMs: null };
    }

    if (res.status === 429 || res.status >= 500 || res.status === 408) {
      await discard(res);
      return { kind: "transient", retryAfterMs: parseRetryAfter(res.headers) };
    }
    if (!res.ok) {
      // 4xx (chave inválida, modelo removido, pedido recusado): não insiste.
      await discard(res);
      return { kind: "fatal" };
    }

    let text: string | null;
    try {
      text = await readCapped(res, opts.maxResponseBytes ?? MAX_RESPONSE_BYTES);
    } catch {
      return timedOut
        ? { kind: "timeout" }
        : { kind: "transient", retryAfterMs: null };
    }
    if (text === null) return { kind: "invalid" };
    const content = extractContent(text);
    return content === null
      ? { kind: "invalid" }
      : { kind: "ok", text: content };
  } finally {
    clearTimeout(timer);
  }
}

async function discard(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // nada a fazer
  }
}

// Retry-After em segundos inteiros (o formato de data HTTP é ignorado: sem relógio
// confiável, cai no backoff padrão). Sem float.
export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1000;
}

async function readCapped(res: Response, max: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    await discard(res);
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

// choices[0].message.content, como texto. Qualquer outro formato é inválido.
function extractContent(envelope: string): string | null {
  try {
    const data = JSON.parse(envelope) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() : null;
  } catch {
    return null;
  }
}
