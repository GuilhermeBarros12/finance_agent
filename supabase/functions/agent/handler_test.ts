// Testes do handler com dublês em memória (T18). Não usam rede nem Supabase.
import {
  assert,
  assertEquals,
  assertFalse,
  assertNotStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { handleAgentRequest } from "./handler.ts";
import {
  agentRequest,
  CONV_ANA,
  CONV_BIA,
  FakeWorld,
  JWT_BIA,
  JWT_CAIO,
  REQ_1,
  USER_ANA,
  validBody,
} from "./fakes.ts";
import { canonicalBody, parseAgentRequest, sha256Hex } from "./request.ts";
import { RESERVATION_TTL_MS } from "./idempotency.ts";

// deno-lint-ignore no-explicit-any
type Json = any;

async function call(
  world: FakeWorld,
  req: Request,
): Promise<{ res: Response; body: Json }> {
  const res = await handleAgentRequest(req, world.deps());
  const text = await res.text();
  return { res, body: text ? JSON.parse(text) : null };
}

function hashOf(body: unknown): Promise<string> {
  const parsed = parseAgentRequest(body);
  if (!parsed.ok) throw new Error("corpo de teste inválido");
  return sha256Hex(canonicalBody(parsed.value));
}

// ---------------------------------------------------------------- autenticação

Deno.test("sem JWT: 401 UNAUTHENTICATED e nada é gravado", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(w, agentRequest(validBody(), { jwt: null }));
  assertEquals(res.status, 401);
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(w.runs.length, 0);
  assertEquals(w.messages.length, 0);
});

Deno.test("JWT inválido: 401", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(validBody(), { jwt: "token-desconhecido" }),
  );
  assertEquals(res.status, 401);
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("cabeçalho Authorization fora do formato Bearer: 401", async () => {
  const w = new FakeWorld();
  const req = agentRequest(validBody(), {
    jwt: null,
    headers: { authorization: "Basic abc" },
  });
  assertEquals((await call(w, req)).res.status, 401);
});

Deno.test("usuário fora de allowed_users: 403, antes de validar o corpo", async () => {
  const w = new FakeWorld();
  // Corpo inválido de propósito: a autorização vem antes da validação.
  const { res, body } = await call(
    w,
    agentRequest({ lixo: 1 }, { jwt: JWT_CAIO }),
  );
  assertEquals(res.status, 403);
  assertEquals(body.error.code, "ACCESS_DENIED");
  assertEquals(w.runs.length, 0);
});

Deno.test("usuário desabilitado: 403", async () => {
  const w = new FakeWorld();
  w.allowed.set(USER_ANA, false);
  const { res } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 403);
});

Deno.test("user_id no corpo é recusado; a identidade vem do JWT", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(
      validBody({ user_id: "22222222-2222-4222-8222-222222222222" }),
    ),
  );
  assertEquals(res.status, 400);
  assertEquals(body.error.code, "INVALID_REQUEST");
  assertEquals(w.messages.length, 0);
});

Deno.test("as mensagens gravadas pertencem ao usuário do JWT", async () => {
  const w = new FakeWorld();
  const { res } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 200);
  assert(w.messages.every((m) => m.user_id === USER_ANA));
  assertEquals(w.runs[0].user_id, USER_ANA);
});

// ----------------------------------------------------------------- conversa

Deno.test("conversa de outro dono: 404, sem reserva e sem mensagens", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(validBody({ conversation_id: CONV_BIA })),
  );
  assertEquals(res.status, 404);
  assertEquals(body.error.code, "NOT_FOUND");
  assertEquals(w.runs.length, 0);
  assertEquals(w.messages.length, 0);
});

Deno.test("conversa inexistente: 404", async () => {
  const w = new FakeWorld();
  const { res } = await call(
    w,
    agentRequest(
      validBody({ conversation_id: "c9000000-0000-4000-8000-000000000009" }),
    ),
  );
  assertEquals(res.status, 404);
});

Deno.test("a mesma resposta 404 vale para dono diferente", async () => {
  const w = new FakeWorld();
  const { res } = await call(
    w,
    agentRequest(validBody({ conversation_id: CONV_ANA }), { jwt: JWT_BIA }),
  );
  assertEquals(res.status, 404);
});

// ----------------------------------------------------------------- validação

Deno.test("corpo inválido: 400 com caminhos, sem eco do valor recebido", async () => {
  const w = new FakeWorld();
  const cases: unknown[] = [
    {},
    validBody({ selection: undefined }),
    validBody({ request_id: "nao-e-uuid" }),
    validBody({ conversation_id: 7 }),
    validBody({ selection: { asset_ids: [], metrics: ["roe"] } }),
    validBody({ selection: { asset_ids: ["DEMO3"], metrics: [] } }),
    validBody({ selection: { asset_ids: ["demo3"], metrics: ["roe"] } }),
    validBody({
      selection: { asset_ids: ["DEMO3", "DEMO3"], metrics: ["roe"] },
    }),
    validBody({ selection: { asset_ids: ["DEMO3"], metrics: ["cap_rate"] } }),
    validBody({ selection: { asset_ids: ["DEMO3"], metrics: ["roe", "roe"] } }),
    validBody({
      selection: { asset_ids: ["DEMO3"], metrics: ["roe"], extra: 1 },
    }),
    validBody({ extra: true }),
    validBody({ message: 123 }),
    validBody({
      selection: {
        asset_ids: Array.from({ length: 21 }, (_, i) => `AAA${i}`),
        metrics: ["roe"],
      },
    }),
  ];
  for (const c of cases) {
    const { res, body } = await call(w, agentRequest(c));
    assertEquals(res.status, 400, JSON.stringify(c));
    assertEquals(body.error.code, "INVALID_REQUEST");
    assert(Array.isArray(body.error.details));
  }
  assertEquals(w.runs.length, 0);
});

Deno.test("JSON malformado: 400; corpo grande demais: 413", async () => {
  const w = new FakeWorld();
  const bad = await call(w, agentRequest("{nao-json"));
  assertEquals(bad.res.status, 400);
  const big = await call(
    w,
    agentRequest(validBody({ message: "x".repeat(70_000) })),
  );
  assertEquals(big.res.status, 413);
  assertEquals(big.body.error.code, "PAYLOAD_TOO_LARGE");
});

Deno.test("limite de message: 8.000 caracteres passam, 8.001 não", async () => {
  const w = new FakeWorld();
  const ok = await call(
    w,
    agentRequest(validBody({ message: "a".repeat(8000) })),
  );
  assertEquals(ok.res.status, 200);

  const w2 = new FakeWorld();
  const over = await call(
    w2,
    agentRequest(validBody({ message: "a".repeat(8001) })),
  );
  assertEquals(over.res.status, 400);
  assertEquals(over.body.error.details[0].path, "message");
  assertEquals(w2.runs.length, 0);
});

Deno.test("limite de message conta caracteres, não bytes nem unidades UTF-16", async () => {
  const w = new FakeWorld();
  // 8000 emojis = 16000 unidades UTF-16 e 32000 bytes, mas 8000 caracteres.
  const ok = await call(
    w,
    agentRequest(validBody({ message: "😀".repeat(8000) })),
  );
  assertEquals(ok.res.status, 200);
});

Deno.test("message com substituto UTF-16 isolado: 400", async () => {
  const w = new FakeWorld();
  const { res } = await call(
    w,
    agentRequest(validBody({ message: "oi \ud800" })),
  );
  assertEquals(res.status, 400);
});

Deno.test("método diferente de POST: 405; OPTIONS: 204", async () => {
  const w = new FakeWorld();
  const get = await call(w, agentRequest(null, { method: "GET" }));
  assertEquals(get.res.status, 405);
  const opt = await call(
    w,
    agentRequest(null, { method: "OPTIONS", jwt: null }),
  );
  assertEquals(opt.res.status, 204);
});

// ------------------------------------------------------------ ativos e snapshot

Deno.test("ativo fora do universo: 422 UNSUPPORTED_ASSET; reserva marcada como falha", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(validBody({
      selection: { asset_ids: ["DEMO3", "ZZZZ9"], metrics: ["roe"] },
    })),
  );
  assertEquals(res.status, 422);
  assertEquals(body.error.code, "UNSUPPORTED_ASSET");
  assertEquals(body.error.details.asset_ids, ["ZZZZ9"]);
  assertEquals(w.messages.length, 0);
  assertEquals(w.runs[0].status, "failed");
  assertEquals(w.runs[0].error, "UNSUPPORTED_ASSET");
});

Deno.test("sem snapshot ativo: 503 DATA_UNAVAILABLE e nenhuma mensagem", async () => {
  const w = new FakeWorld();
  w.snapshot = null;
  const { res, body } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 503);
  assertEquals(body.error.code, "DATA_UNAVAILABLE");
  assertEquals(w.messages.length, 0);
});

Deno.test("snapshot sem published_at não é usado: 503", async () => {
  const w = new FakeWorld();
  w.snapshot = { ...w.market.snapshot, published_at: null };
  const { res } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 503);
});

Deno.test("falha de dados vira erro, nunca resposta com zero", async () => {
  const w = new FakeWorld();
  // Validação divergente que escolheu um lado: viola o contrato da T06.
  w.market.validations[1] = {
    ...w.market.validations[1],
    selected_observation_id: w.market.validations[1].observation_ids[0],
  };
  const { res, body } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 500);
  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertEquals(w.messages.length, 0);
  assertEquals(w.runs[0].status, "failed");
});

// ------------------------------------------------------------- idempotência

Deno.test("repetir o mesmo request_id devolve a resposta gravada sem duplicar mensagens", async () => {
  const w = new FakeWorld();
  const first = await call(w, agentRequest(validBody({ message: "oi" })));
  assertEquals(first.res.status, 200);
  assertEquals(w.messages.length, 2);
  const callsAfterFirst = w.marketCalls;

  const again = await call(w, agentRequest(validBody({ message: "oi" })));
  assertEquals(again.res.status, 200);
  assertEquals(again.res.headers.get("idempotent-replay"), "true");
  assertEquals(again.body, first.body);
  assertEquals(w.messages.length, 2);
  assertEquals(w.runs.length, 1);
  // Não releu o mercado: devolveu o que estava gravado.
  assertEquals(w.marketCalls, callsAfterFirst);
});

Deno.test("mesmo request_id com corpo diferente: 409 REQUEST_CONFLICT", async () => {
  const w = new FakeWorld();
  await call(w, agentRequest(validBody({ message: "oi" })));
  const variants = [
    validBody({ message: "outra" }),
    validBody({
      selection: {
        asset_ids: ["TEST4"],
        metrics: ["price_to_book", "dividend_yield"],
      },
    }),
    validBody({
      selection: {
        asset_ids: ["DEMO3"],
        metrics: ["dividend_yield", "price_to_book"],
      },
    }),
  ];
  for (const v of variants) {
    const { res, body } = await call(w, agentRequest(v));
    assertEquals(res.status, 409);
    assertEquals(body.error.code, "REQUEST_CONFLICT");
  }
  assertEquals(w.messages.length, 2);
});

Deno.test("conflito vale também com a reserva em andamento", async () => {
  const w = new FakeWorld();
  w.runs.push({
    id: "run-x",
    user_id: USER_ANA,
    request_id: REQ_1,
    conversation_id: CONV_ANA,
    status: "processing",
    body_hash: await hashOf(validBody()),
    response: null,
    error: null,
    updated_at: w.clock.toISOString(),
  });
  const { res } = await call(
    w,
    agentRequest(validBody({ message: "diferente" })),
  );
  assertEquals(res.status, 409);
});

Deno.test("corpo equivalente (message ausente, nula ou em branco) é o mesmo pedido", async () => {
  const w = new FakeWorld();
  const first = await call(w, agentRequest(validBody()));
  const nulo = await call(w, agentRequest(validBody({ message: null })));
  const branco = await call(w, agentRequest(validBody({ message: "   " })));
  assertEquals(first.res.status, 200);
  assertEquals(nulo.res.status, 200);
  assertEquals(branco.res.status, 200);
  assertEquals(w.messages.length, 2);
});

Deno.test("reserva em andamento: 202 sem tocar em mensagens", async () => {
  const w = new FakeWorld();
  w.runs.push({
    id: "run-x",
    user_id: USER_ANA,
    request_id: REQ_1,
    conversation_id: CONV_ANA,
    status: "processing",
    body_hash: await hashOf(validBody()),
    response: null,
    error: null,
    updated_at: w.clock.toISOString(),
  });
  const { res, body } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 202);
  assertEquals(body.status, "processing");
  assertEquals(body.request_id, REQ_1);
  assertEquals(w.messages.length, 0);
  assertEquals(w.runs[0].status, "processing");
});

Deno.test("reserva com 3 minutos exatos ainda está em andamento; acima disso expira e é retomada", async () => {
  const w = new FakeWorld();
  w.runs.push({
    id: "run-x",
    user_id: USER_ANA,
    request_id: REQ_1,
    conversation_id: CONV_ANA,
    status: "processing",
    body_hash: await hashOf(validBody()),
    response: null,
    error: null,
    updated_at: w.clock.toISOString(),
  });
  w.advance(RESERVATION_TTL_MS);
  assertEquals((await call(w, agentRequest(validBody()))).res.status, 202);

  w.advance(1);
  const { res } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 200);
  assertEquals(w.runs.length, 1);
  assertEquals(w.runs[0].status, "succeeded");
  assertEquals(w.messages.length, 2);

  // Depois de concluída, repetir só devolve a resposta.
  const replay = await call(w, agentRequest(validBody()));
  assertEquals(replay.res.status, 200);
  assertEquals(w.messages.length, 2);
});

Deno.test("reserva expirada cujo turno já foi gravado não duplica mensagens", async () => {
  const w = new FakeWorld();
  // Primeira execução grava as mensagens e "morre" antes de concluir a reserva.
  const first = await call(w, agentRequest(validBody()));
  assertEquals(first.res.status, 200);
  w.runs[0].status = "processing";
  w.runs[0].response = null;
  w.runs[0].updated_at = w.clock.toISOString();
  w.advance(RESERVATION_TTL_MS + 1);

  const { res } = await call(w, agentRequest(validBody()));
  assertEquals(res.status, 200);
  assertEquals(w.messages.length, 2);
  assertEquals(w.runs[0].status, "succeeded");
});

Deno.test("dois pedidos em corrida pela mesma reserva expirada: só um assume", async () => {
  const w = new FakeWorld();
  w.runs.push({
    id: "run-x",
    user_id: USER_ANA,
    request_id: REQ_1,
    conversation_id: CONV_ANA,
    status: "processing",
    body_hash: await hashOf(validBody()),
    response: null,
    error: null,
    updated_at: w.clock.toISOString(),
  });
  w.advance(RESERVATION_TTL_MS + 1);
  const deps = w.deps();
  const [a, b] = await Promise.all([
    handleAgentRequest(agentRequest(validBody()), deps),
    handleAgentRequest(agentRequest(validBody()), deps),
  ]);
  const statuses = [a.status, b.status].sort();
  // Um conclui; o outro vê a reserva recém-tomada (202) ou já a resposta (200).
  assert(statuses[0] === 200);
  assert(statuses[1] === 200 || statuses[1] === 202);
  assertEquals(w.messages.length, 2);
});

Deno.test("falha no meio libera o mesmo pedido para nova tentativa imediata", async () => {
  const w = new FakeWorld();
  w.failPersist = true;
  const failed = await call(w, agentRequest(validBody()));
  assertEquals(failed.res.status, 500);
  assertEquals(w.runs[0].status, "failed");
  assertEquals(w.messages.length, 0);

  w.failPersist = false;
  const retry = await call(w, agentRequest(validBody()));
  assertEquals(retry.res.status, 200);
  assertEquals(w.messages.length, 2);
  assertEquals(w.runs.length, 1);
});

Deno.test("falha antes tem erro estruturado e não vaza o motivo interno", async () => {
  const w = new FakeWorld();
  w.failPersist = true;
  const { body } = await call(w, agentRequest(validBody()));
  assertEquals(Object.keys(body), ["error"]);
  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertFalse(JSON.stringify(body).includes("simulada"));
});

// ------------------------------------------------------- resposta e evidências

Deno.test("divergent: selected_observation_id nulo e as duas observações na evidência", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(validBody({
      selection: { asset_ids: ["DEMO3"], metrics: ["dividend_yield"] },
    })),
  );
  assertEquals(res.status, 200);
  const p = body.payload;
  const v = p.evidence.validations.find((x: Json) =>
    x.metric === "dividend_yield"
  );
  assertEquals(v.status, "divergent");
  assertEquals(v.selected_observation_id, null);
  assertEquals(v.observation_ids.length, 2);
  const ids = p.evidence.observations.map((o: Json) => o.observation_id).sort();
  assertEquals(ids, [...v.observation_ids].sort());
  // Valores de cada fonte intactos, como texto, sem média nem escolha.
  const values = p.evidence.observations.map((o: Json) => o.value_decimal)
    .sort();
  assertEquals(values, ["8.50", "9.10"]);
  assertEquals(
    new Set(p.evidence.observations.map((o: Json) => o.source_id)).size,
    2,
  );
  // A divergência aparece na tabela do indicador, com os dois lados.
  assertEquals(p.sections, [
    {
      kind: "metric_table",
      metric: "dividend_yield",
      validation_ids: [v.validation_id],
    },
  ]);
  // Nada foi escolhido: nenhum campo "valor" único inventado.
  assertFalse("value" in v);
});

Deno.test("verified, single_source, incomparable e missing aparecem nas seções certas", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(validBody({
      selection: {
        asset_ids: ["DEMO3", "TEST4", "ONEA3"],
        metrics: ["price_to_book", "price_to_earnings", "roe"],
      },
    })),
  );
  assertEquals(res.status, 200);
  const p = body.payload;
  const byId = new Map(
    p.evidence.validations.map((v: Json) => [v.validation_id, v]),
  );
  const statusOf = (id: string) => (byId.get(id) as Json).status;

  const tables = p.sections.filter((s: Json) => s.kind === "metric_table");
  assertEquals(tables.map((t: Json) => t.metric), ["price_to_book", "roe"]);
  assertEquals(tables[0].validation_ids.map(statusOf), ["verified"]);
  assertEquals(tables[1].validation_ids.map(statusOf), ["single_source"]);

  const limitation = p.sections.filter((s: Json) => s.kind === "limitation");
  assertEquals(limitation.length, 1);
  assertEquals(limitation[0].validation_ids.map(statusOf).sort(), [
    "incomparable",
    "missing",
  ]);
  assertEquals(Object.keys(limitation[0]).sort(), ["kind", "validation_ids"]);

  // verified aponta uma observação selecionada; single_source também.
  const verified = p.evidence.validations.find((v: Json) =>
    v.status === "verified"
  );
  assertEquals(verified.selected_observation_id, verified.observation_ids[0]);
  const single = p.evidence.validations.find((v: Json) =>
    v.status === "single_source"
  );
  assertEquals(single.observation_ids.length, 1);
  // incomparable não escolhe lado e mantém as duas fontes na evidência.
  const inc = p.evidence.validations.find((v: Json) =>
    v.status === "incomparable"
  );
  assertEquals(inc.selected_observation_id, null);
  assertEquals(inc.observation_ids.length, 2);
  // missing: sem observação, sem valor.
  const miss = p.evidence.validations.find((v: Json) => v.status === "missing");
  assertEquals(miss.observation_ids, []);
  assertEquals(miss.selected_observation_id, null);
  assertEquals(body.coverage.status, "partial");
  assertEquals(
    body.coverage.missing_fields.map((m: Json) =>
      `${m.asset_id}:${m.metric}:${m.reason}`
    ).sort(),
    [
      // Combinações que o lote nem tem: avisadas, nunca preenchidas com valor de outro ativo.
      "DEMO3:price_to_earnings:not_in_snapshot",
      "DEMO3:roe:not_in_snapshot",
      "ONEA3:price_to_book:not_in_snapshot",
      "ONEA3:price_to_earnings:not_in_snapshot",
      "TEST4:price_to_book:not_in_snapshot",
      "TEST4:price_to_earnings:incomparable",
      "TEST4:roe:missing",
    ],
  );
});

Deno.test("um campo não herda a validação de outro", async () => {
  const w = new FakeWorld();
  const { body } = await call(w, agentRequest(validBody()));
  const vs = body.payload.evidence.validations;
  const pb = vs.find((v: Json) => v.metric === "price_to_book");
  const dy = vs.find((v: Json) => v.metric === "dividend_yield");
  assertEquals(pb.status, "verified");
  assertEquals(dy.status, "divergent");
  // Cada validação só lista observações do próprio campo.
  const obs = new Map(
    body.payload.evidence.observations.map((o: Json) => [o.observation_id, o]),
  );
  for (const v of vs) {
    for (const id of v.observation_ids) {
      assertEquals((obs.get(id) as Json).metric, v.metric);
      assertEquals((obs.get(id) as Json).asset_id, v.asset_id);
    }
  }
});

Deno.test("campo sem validação no lote vira aviso, não valor nem tabela vazia", async () => {
  const w = new FakeWorld();
  const { res, body } = await call(
    w,
    agentRequest(validBody({
      selection: { asset_ids: ["DEMO3"], metrics: ["quote_price"] },
    })),
  );
  assertEquals(res.status, 200);
  const p = body.payload;
  assertEquals(p.sections, []);
  assertEquals(p.evidence.validations, []);
  assertEquals(p.evidence.observations, []);
  assertEquals(p.warnings[0].code, "FIELD_NOT_IN_SNAPSHOT");
  assertEquals(p.warnings[0].asset_id, "DEMO3");
  assertEquals(body.coverage.status, "partial");
  assertEquals(body.citations, []);
});

Deno.test("payload versão 1 tem exatamente o formato do plano", async () => {
  const w = new FakeWorld();
  const { body } = await call(w, agentRequest(validBody()));
  const p = body.payload;
  assertEquals(Object.keys(p).sort(), [
    "content_version",
    "evidence",
    "manifest",
    "mode",
    "sections",
    "snapshot_collected_at",
    "snapshot_id",
    "warnings",
  ]);
  assertEquals(p.content_version, 1);
  assertEquals(p.mode, "deterministic");
  assertEquals(p.snapshot_id, w.market.snapshot.id);
  assertEquals(p.snapshot_collected_at, "2026-09-18T20:05:00+00:00");
  assertEquals(p.manifest, { assets_total: 3, assets_updated: 3 });
  assertEquals(Object.keys(p.evidence).sort(), ["observations", "validations"]);
  assertEquals(body.mode, "deterministic");
  assertEquals(body.status, "completed");
  assertEquals(body.snapshot_id, w.market.snapshot.id);
  // Há números de mercado, então há citações com fonte e data.
  assert(body.citations.length > 0);
  for (const c of body.citations) {
    assert(c.source_url.startsWith("https://"));
    assert(c.collected_at);
  }
});

Deno.test("valores financeiros ficam como string, com a escala original", async () => {
  const w = new FakeWorld();
  const { body } = await call(w, agentRequest(validBody()));
  for (const o of body.payload.evidence.observations) {
    assertEquals(typeof o.value_decimal, "string");
  }
  const dy = body.payload.evidence.validations.find((v: Json) =>
    v.metric === "dividend_yield"
  );
  assertEquals(dy.comparison.delta_abs, "0.60");
  assertEquals(typeof dy.comparison.limit, "string");
  const values = body.payload.evidence.observations.map((o: Json) =>
    o.value_decimal
  );
  assert(values.includes("8.50"));
});

Deno.test("a evidência é uma cópia: mudar os dados de origem não altera a mensagem", async () => {
  const w = new FakeWorld();
  const { body } = await call(w, agentRequest(validBody()));
  const stored = w.messages.find((m) => m.role === "assistant")!;
  assertEquals(stored.payload, body.payload);
  assertNotStrictEquals(stored.payload, body.payload);

  // Simula a retenção apagando/alterando o snapshot de origem.
  w.market.observations.length = 0;
  w.market.validations.length = 0;
  w.snapshot = null;
  const payload = stored.payload as Json;
  assertEquals(payload.evidence.observations.length, 4);
  assertEquals(payload.evidence.validations.length, 2);
  // E o replay continua entregando a resposta completa mesmo sem snapshot.
  const replay = await call(w, agentRequest(validBody()));
  assertEquals(replay.res.status, 200);
  assertEquals(replay.body.payload.evidence.observations.length, 4);
});

Deno.test("mensagens gravadas: usuário e assistente, em sequência, com payload só no assistente", async () => {
  const w = new FakeWorld();
  const { body } = await call(
    w,
    agentRequest(validBody({ message: "Compare" })),
  );
  assertEquals(w.messages.map((m) => [m.role, m.sequence_no]), [
    ["user", 1],
    ["assistant", 2],
  ]);
  assertEquals(w.messages[0].content, "Compare");
  assertEquals(w.messages[0].payload, null);
  assertEquals(w.messages[1].id, body.message_id);
  assertEquals(w.messages[0].id, body.user_message_id);
  assertStringIncludes(w.messages[1].content, "sem IA");

  // Segundo turno na mesma conversa continua a sequência.
  const second = await call(
    w,
    agentRequest(
      validBody({ request_id: "7e51ed30-9fd4-48fd-9a19-060f8197cda1" }),
    ),
  );
  assertEquals(second.res.status, 200);
  assertEquals(w.messages.map((m) => m.sequence_no), [1, 2, 3, 4]);
  assertStringIncludes(w.messages[2].content, "Consulta manual");
});

Deno.test("ordem da resposta segue a ordem pedida de ativos e indicadores", async () => {
  const w = new FakeWorld();
  const { body } = await call(
    w,
    agentRequest(validBody({
      selection: {
        asset_ids: ["ONEA3", "DEMO3"],
        metrics: ["roe", "price_to_book"],
      },
    })),
  );
  assertEquals(
    body.payload.sections.map((s: Json) => s.metric),
    ["roe", "price_to_book"],
  );
});

Deno.test("avisos: dado desatualizado e cobertura parcial do lote", async () => {
  const w = new FakeWorld();
  w.market.validations[0] = { ...w.market.validations[0], freshness: "stale" };
  w.snapshot = { ...w.market.snapshot, assets_updated: 2 };
  const { body } = await call(w, agentRequest(validBody()));
  const codes = body.payload.warnings.map((x: Json) => x.code).sort();
  assertEquals(codes, ["PARTIAL_COVERAGE", "STALE_DATA"]);
  assertEquals(body.payload.manifest, { assets_total: 3, assets_updated: 2 });
});

// ------------------------------------------------------------------ CORS e log

Deno.test("CORS: só devolve a origem configurada, nunca *", async () => {
  const w = new FakeWorld();
  w.origins = ["http://localhost:5173"];
  const ok = await call(
    w,
    agentRequest(validBody(), { headers: { origin: "http://localhost:5173" } }),
  );
  assertEquals(
    ok.res.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assertEquals(ok.res.headers.get("access-control-allow-credentials"), null);

  const other = await call(
    w,
    agentRequest(
      validBody({ request_id: "7e51ed30-9fd4-48fd-9a19-060f8197cda1" }),
      {
        headers: { origin: "https://evil.example" },
      },
    ),
  );
  assertEquals(other.res.headers.get("access-control-allow-origin"), null);

  const pre = await call(
    w,
    agentRequest(null, {
      method: "OPTIONS",
      jwt: null,
      headers: { origin: "http://localhost:5173" },
    }),
  );
  assertEquals(pre.res.status, 204);
  assertEquals(
    pre.res.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  assertStringIncludes(
    pre.res.headers.get("access-control-allow-headers") ?? "",
    "authorization",
  );

  // Erros também levam o cabeçalho, para o navegador conseguir ler o corpo.
  const err = await call(
    w,
    agentRequest(validBody(), {
      jwt: null,
      headers: { origin: "http://localhost:5173" },
    }),
  );
  assertEquals(err.res.status, 401);
  assertEquals(
    err.res.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
});

Deno.test("log não contém o JWT nem o texto da mensagem", async () => {
  const w = new FakeWorld();
  const segredo = "texto-privado-da-mensagem-123";
  await call(w, agentRequest(validBody({ message: segredo })));
  await call(
    w,
    agentRequest(validBody({ message: "x".repeat(9000) }), { jwt: JWT_BIA }),
  );
  assert(w.logs.length >= 2);
  const dump = JSON.stringify(w.logs);
  assertFalse(dump.includes(segredo));
  assertFalse(dump.includes("jwt-ana"));
  assertFalse(dump.includes("jwt-bia"));
  assertEquals(w.logs[0].status, 200);
  assertEquals(w.logs[0].user_id, USER_ANA);
});
