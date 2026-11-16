import { assertEquals, assertFalse, assertThrows } from "@std/assert";
import {
  DEFAULT_DAILY_LIMIT,
  DEFAULT_GROQ_MODEL,
  LlmConfigError,
  resolveLlmConfig,
} from "./config.ts";
import { createLlmService, MAX_LLM_INPUT_CHARS } from "./service.ts";
import { FakeProvider, FakeQuota, forbiddenFetch, groqReply } from "./fakes.ts";

globalThis.fetch = forbiddenFetch;

const env = (vars: Record<string, string>) => (n: string) => vars[n];
const UNIVERSE = ["DEMO3", "TEST4", "ONEA3"];

Deno.test("MOCK_LLM=true recusado em APP_ENV hospedado, ausente ou desconhecido", () => {
  for (
    const appEnv of [
      "production",
      "staging",
      "prod",
      "hosted",
      "",
      "Production ",
    ]
  ) {
    assertThrows(
      () => resolveLlmConfig(env({ MOCK_LLM: "true", APP_ENV: appEnv })),
      LlmConfigError,
      "MOCK_LLM=true",
      appEnv,
    );
  }
  // Sem APP_ENV algum.
  assertThrows(
    () => resolveLlmConfig(env({ MOCK_LLM: "true" })),
    LlmConfigError,
  );
});

Deno.test("MOCK_LLM=true aceito em local e test", () => {
  for (const appEnv of ["local", "test", " LOCAL "]) {
    assertEquals(
      resolveLlmConfig(env({ MOCK_LLM: "true", APP_ENV: appEnv })),
      { mode: "mock" },
    );
  }
});

Deno.test("recusa de mock não vaza a chave", () => {
  try {
    resolveLlmConfig(
      env({
        MOCK_LLM: "true",
        APP_ENV: "production",
        GROQ_API_KEY: "segredo-xyz",
      }),
    );
  } catch (e) {
    assertFalse(String((e as Error).message).includes("segredo-xyz"));
    return;
  }
  throw new Error("deveria recusar");
});

Deno.test("MOCK_LLM com valor ambíguo é erro de configuração", () => {
  assertThrows(() => resolveLlmConfig(env({ MOCK_LLM: "1" })), LlmConfigError);
  assertThrows(
    () => resolveLlmConfig(env({ MOCK_LLM: "yes" })),
    LlmConfigError,
  );
});

Deno.test("sem GROQ_API_KEY e sem mock: desabilitado (nada é chamado)", () => {
  assertEquals(resolveLlmConfig(env({})), { mode: "disabled" });
  assertEquals(
    resolveLlmConfig(env({ MOCK_LLM: "false", GROQ_API_KEY: "  " })),
    {
      mode: "disabled",
    },
  );
});

Deno.test("GROQ_API_KEY, modelo padrão e limite padrão", () => {
  assertEquals(
    resolveLlmConfig(env({ GROQ_API_KEY: "k", APP_ENV: "production" })),
    {
      mode: "groq",
      apiKey: "k",
      model: DEFAULT_GROQ_MODEL,
      dailyLimit: DEFAULT_DAILY_LIMIT,
    },
  );
  assertEquals(DEFAULT_GROQ_MODEL, "openai/gpt-oss-120b");
  assertEquals(
    resolveLlmConfig(
      env({
        GROQ_API_KEY: "k",
        GROQ_MODEL: "outro/modelo-1",
        LLM_DAILY_LIMIT: "50",
      }),
    ),
    { mode: "groq", apiKey: "k", model: "outro/modelo-1", dailyLimit: 50 },
  );
});

Deno.test("LLM_DAILY_LIMIT e GROQ_MODEL inválidos são erro de configuração", () => {
  for (const v of ["-1", "1.5", "abc", "99999999", "1e3"]) {
    assertThrows(
      () => resolveLlmConfig(env({ GROQ_API_KEY: "k", LLM_DAILY_LIMIT: v })),
      LlmConfigError,
      "LLM_DAILY_LIMIT",
      v,
    );
  }
  assertThrows(
    () => resolveLlmConfig(env({ GROQ_API_KEY: "k", GROQ_MODEL: "a b\nc" })),
    LlmConfigError,
  );
  // Limite zero é válido: desliga o uso sem apagar a chave.
  assertEquals(
    (resolveLlmConfig(env({ GROQ_API_KEY: "k", LLM_DAILY_LIMIT: "0" })) as {
      dailyLimit: number;
    }).dailyLimit,
    0,
  );
});

// ------------------------------------------------------------------ service

Deno.test("serviço desabilitado: LLM_DISABLED sem tocar fetch nem cota", async () => {
  const quota = new FakeQuota();
  const svc = createLlmService({
    config: { mode: "disabled" },
    fetch: forbiddenFetch,
    consumeQuota: quota.consume,
  });
  const r = await svc.classify("compare DEMO3", UNIVERSE);
  assertEquals(r, { ok: false, code: "LLM_DISABLED", calls: 0 });
  assertEquals(quota.calls.length, 0);
});

Deno.test("MOCK_LLM: classificação fixa, sem fetch e sem cota", async () => {
  const quota = new FakeQuota();
  const svc = createLlmService({
    config: { mode: "mock" },
    fetch: forbiddenFetch,
    consumeQuota: quota.consume,
  });
  const a = await svc.classify("qualquer coisa", UNIVERSE);
  const b = await svc.classify("outra coisa totalmente diferente", UNIVERSE);
  assertEquals(a, {
    ok: true,
    source: "mock",
    selection: { asset_ids: ["DEMO3"], metrics: ["dividend_yield"] },
    calls: 0,
  });
  assertEquals(a, b);
  assertEquals(quota.calls.length, 0);
});

Deno.test("mock também passa pela validação do universo", async () => {
  const svc = createLlmService({
    config: { mode: "mock" },
    fetch: forbiddenFetch,
    consumeQuota: () => Promise.resolve(true),
  });
  const r = await svc.classify("x", ["TEST4"]);
  assertEquals(r, { ok: false, code: "LLM_INVALID_OUTPUT", calls: 0 });
});

Deno.test("mensagem longa demais e universo vazio: nenhuma chamada", async () => {
  const quota = new FakeQuota();
  const provider = new FakeProvider([groqReply("{}")]);
  const svc = createLlmService({
    config: { mode: "groq", apiKey: "k", model: "m", dailyLimit: 5 },
    fetch: provider.fetch,
    consumeQuota: quota.consume,
  });
  const long = await svc.classify(
    "a".repeat(MAX_LLM_INPUT_CHARS + 1),
    UNIVERSE,
  );
  assertEquals(long, { ok: false, code: "LLM_INPUT_TOO_LONG", calls: 0 });
  assertEquals(await svc.classify("compare", []), {
    ok: false,
    code: "LLM_NO_UNIVERSE",
    calls: 0,
  });
  assertEquals(provider.calls.length, 0);
  assertEquals(quota.calls.length, 0);
});

Deno.test("groq: usa o limite diário configurado e o provedor 'groq'", async () => {
  const quota = new FakeQuota();
  const provider = new FakeProvider([
    groqReply(
      JSON.stringify({
        intent: "lookup",
        asset_ids: ["TEST4"],
        metrics: ["roe"],
      }),
    ),
  ]);
  const svc = createLlmService({
    config: { mode: "groq", apiKey: "k", model: "m", dailyLimit: 7 },
    fetch: provider.fetch,
    consumeQuota: quota.consume,
  });
  const r = await svc.classify("ROE de TEST4", UNIVERSE);
  assertEquals(r, {
    ok: true,
    source: "llm",
    selection: { asset_ids: ["TEST4"], metrics: ["roe"] },
    calls: 1,
  });
  assertEquals(quota.calls, [{ provider: "groq", limit: 7 }]);
});

Deno.test("groq: intent unsupported vira LLM_UNSUPPORTED", async () => {
  const provider = new FakeProvider([
    groqReply(
      JSON.stringify({ intent: "unsupported", asset_ids: [], metrics: [] }),
    ),
  ]);
  const svc = createLlmService({
    config: { mode: "groq", apiKey: "k", model: "m", dailyLimit: 7 },
    fetch: provider.fetch,
    consumeQuota: () => Promise.resolve(true),
  });
  assertEquals(await svc.classify("qual o clima?", UNIVERSE), {
    ok: false,
    code: "LLM_UNSUPPORTED",
    calls: 1,
  });
});
