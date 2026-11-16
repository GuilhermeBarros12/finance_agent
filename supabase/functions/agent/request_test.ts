import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  canonicalBody,
  deriveUuid,
  parseAgentRequest,
  sha256Hex,
} from "./request.ts";
import { parseOrigins } from "./cors.ts";
import { readEnv } from "./store.ts";
import { RESERVATION_TTL_MS, reserveRun } from "./idempotency.ts";
import type { NewRun, RunRepo, RunRow } from "./types.ts";
import { CONV_ANA, REQ_1, USER_ANA, validBody } from "./fakes.ts";

Deno.test("hash: ordem das chaves e message ausente/nula não mudam o hash", async () => {
  const a = parseAgentRequest(validBody());
  const b = parseAgentRequest({
    selection: {
      metrics: ["price_to_book", "dividend_yield"],
      asset_ids: ["DEMO3"],
    },
    message: null,
    conversation_id: CONV_ANA,
    request_id: REQ_1,
  });
  assert(a.ok && b.ok);
  assertEquals(
    await sha256Hex(canonicalBody(a.value)),
    await sha256Hex(canonicalBody(b.value)),
  );
});

Deno.test("hash: ids em maiúsculas equivalem aos em minúsculas; conteúdo diferente muda o hash", async () => {
  const a = parseAgentRequest(validBody());
  const up = parseAgentRequest(validBody({ request_id: REQ_1.toUpperCase() }));
  const other = parseAgentRequest(validBody({ message: "x" }));
  assert(a.ok && up.ok && other.ok);
  const h = (r: typeof a) => sha256Hex(canonicalBody(r.value));
  assertEquals(await h(a), await h(up));
  assertNotEquals(await h(a), await h(other));
  assertEquals((await h(a)).length, 64);
});

Deno.test("deriveUuid é estável, distingue sementes e tem formato de UUID", async () => {
  const a = await deriveUuid("x:user");
  assertEquals(a, await deriveUuid("x:user"));
  assertNotEquals(a, await deriveUuid("x:assistant"));
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(a),
  );
});

Deno.test("APP_ORIGINS: descarta * e entradas vazias", () => {
  assertEquals(parseOrigins(undefined), []);
  assertEquals(parseOrigins("*"), []);
  assertEquals(
    parseOrigins(" http://a.test/ , ,*,https://b.test"),
    ["http://a.test", "https://b.test"],
  );
});

Deno.test("readEnv exige URL, chave pública e chave administrativa do ambiente", () => {
  const full = {
    SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_ANON_KEY: "a",
    SUPABASE_SERVICE_ROLE_KEY: "s",
    APP_ORIGINS: "http://x.test",
  } as Record<string, string>;
  const env = readEnv((n) => full[n]);
  assertEquals(env.origins, ["http://x.test"]);
  assertEquals(env.serviceKey, "s");
  let threw = false;
  try {
    readEnv((n) => n === "SUPABASE_SERVICE_ROLE_KEY" ? undefined : full[n]);
  } catch {
    threw = true;
  }
  assert(threw);
  // Nomes alternativos (chaves novas do Supabase).
  const alt = readEnv((n) =>
    ({
      SUPABASE_URL: "u",
      SUPABASE_PUBLISHABLE_KEY: "p",
      SUPABASE_SECRET_KEY: "k",
    })[
      n as "SUPABASE_URL"
    ]
  );
  assertEquals(alt.anonKey, "p");
  assertEquals(alt.serviceKey, "k");
});

// reserveRun isolado, contra um repositório mínimo.
function repoWith(existing: RunRow | null, takeOverWins = true) {
  const calls: string[] = [];
  const repo: RunRepo = {
    insert: (_r: NewRun) =>
      Promise.resolve(
        existing
          ? { ok: false as const, reason: "duplicate" as const }
          : { ok: true as const, run: { id: "novo" } as RunRow },
      ),
    find: () => Promise.resolve(existing),
    takeOver: (id, from) => {
      calls.push(`${id}:${from}`);
      return Promise.resolve(takeOverWins);
    },
    complete: () => Promise.resolve(),
    fail: () => Promise.resolve(),
  };
  return { repo, calls };
}

const NOW = new Date("2026-09-19T12:00:00.000Z");
const input: NewRun = {
  user_id: USER_ANA,
  request_id: REQ_1,
  conversation_id: CONV_ANA,
  body_hash: "a".repeat(64),
};
const run = (over: Partial<RunRow>): RunRow => ({
  id: "r1",
  status: "processing",
  body_hash: input.body_hash,
  response: null,
  updated_at: NOW.toISOString(),
  ...over,
});

Deno.test("reserveRun: fronteira de 3 minutos é estrita", async () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  assertEquals(
    (await reserveRun(
      repoWith(run({ updated_at: at(RESERVATION_TTL_MS) })).repo,
      input,
      NOW,
    )).kind,
    "in_progress",
  );
  const expired = repoWith(run({ updated_at: at(RESERVATION_TTL_MS + 1) }));
  assertEquals((await reserveRun(expired.repo, input, NOW)).kind, "reserved");
  assertEquals(expired.calls, ["r1:processing"]);
});

Deno.test("reserveRun: perder a corrida da retomada vira in_progress", async () => {
  const old = new Date(NOW.getTime() - RESERVATION_TTL_MS - 5).toISOString();
  const { repo } = repoWith(run({ updated_at: old }), false);
  assertEquals((await reserveRun(repo, input, NOW)).kind, "in_progress");
});

Deno.test("reserveRun: data ilegível não retoma; hash nulo é conflito", async () => {
  assertEquals(
    (await reserveRun(repoWith(run({ updated_at: "lixo" })).repo, input, NOW))
      .kind,
    "in_progress",
  );
  assertEquals(
    (await reserveRun(repoWith(run({ body_hash: null })).repo, input, NOW))
      .kind,
    "conflict",
  );
});

Deno.test("reserveRun: concluída devolve a resposta; sem resposta gravada é erro", async () => {
  const r = await reserveRun(
    repoWith(run({ status: "succeeded", response: { ok: 1 } })).repo,
    input,
    NOW,
  );
  assertEquals(r, { kind: "replay", response: { ok: 1 } });
  let threw = false;
  try {
    await reserveRun(repoWith(run({ status: "succeeded" })).repo, input, NOW);
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("reserveRun: falha anterior com o mesmo corpo é retomada", async () => {
  const f = repoWith(run({ status: "failed" }));
  assertEquals((await reserveRun(f.repo, input, NOW)).kind, "reserved");
  assertEquals(f.calls, ["r1:failed"]);
});
