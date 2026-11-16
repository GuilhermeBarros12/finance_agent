import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { handleCatalogRequest } from "./handler.ts";
import {
  ASSETS,
  FakeCatalogStore,
  JWT_ANA,
  JWT_CAIO,
  JWT_DESABILITADO,
  makeDeps,
  SERVICE_KEY_FAKE,
  SNAPSHOT_SEED,
  USER_ANA,
} from "./fakes.ts";

const URL_ = "http://localhost/catalog";
const ORIGIN = "https://app.example.test";

function get(jwt?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (jwt) headers.set("authorization", `Bearer ${jwt}`);
  return new Request(URL_, { method: "GET", ...init, headers });
}

// deno-lint-ignore no-explicit-any
async function body(res: Response): Promise<any> {
  return await res.json();
}

Deno.test("401 sem JWT, com cabeçalho malformado e com chaves de serviço/anon", async () => {
  const h = makeDeps();
  for (
    const req of [
      get(),
      get("", { headers: { authorization: "Basic abc" } }),
      get("", { headers: { authorization: "Bearer" } }),
      get("", { headers: { authorization: "Bearer a b" } }),
      get(SERVICE_KEY_FAKE),
      get("sb_secret_sintetica"),
      get("sb_publishable_sintetica"),
      get("jwt-invalido"),
    ]
  ) {
    const res = await handleCatalogRequest(req, h.deps);
    assertEquals(res.status, 401);
    assertEquals((await body(res)).error.code, "UNAUTHENTICATED");
  }
  assertEquals(h.store.calls, 0, "nada de mercado é lido sem autenticar");
});

Deno.test("403 para usuário fora de allowed_users e para desabilitado", async () => {
  const h = makeDeps();
  for (const jwt of [JWT_CAIO, JWT_DESABILITADO]) {
    const res = await handleCatalogRequest(get(jwt), h.deps);
    assertEquals(res.status, 403);
    assertEquals((await body(res)).error.code, "ACCESS_DENIED");
  }
  assertEquals(h.store.calls, 0, "o mercado só é lido depois de autorizar");
});

Deno.test("405 para métodos diferentes de GET, com Allow", async () => {
  const h = makeDeps();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
    const res = await handleCatalogRequest(
      new Request(URL_, {
        method,
        headers: { authorization: `Bearer ${JWT_ANA}` },
      }),
      h.deps,
    );
    assertEquals(res.status, 405, method);
    assertEquals(res.headers.get("allow"), "GET, OPTIONS");
    if (method !== "HEAD") {
      assertEquals((await body(res)).error.code, "METHOD_NOT_ALLOWED");
    }
  }
  assertEquals(h.store.calls, 0);
});

Deno.test("OPTIONS: 204 com CORS só para origem permitida; '*' descartado; sem credenciais", async () => {
  const h = makeDeps({ origins: ["*", ORIGIN, ""] });
  const ok = await handleCatalogRequest(
    new Request(URL_, { method: "OPTIONS", headers: { origin: ORIGIN } }),
    h.deps,
  );
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(ok.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert(
    ok.headers.get("access-control-allow-headers")?.includes("authorization"),
  );
  assertEquals(ok.headers.get("access-control-allow-credentials"), null);
  assertEquals(ok.headers.get("vary"), "Origin");

  const other = await handleCatalogRequest(
    new Request(URL_, {
      method: "OPTIONS",
      headers: { origin: "https://outro.example.test" },
    }),
    h.deps,
  );
  assertEquals(other.status, 204);
  assertEquals(other.headers.get("access-control-allow-origin"), null);
  assertNotEquals(other.headers.get("access-control-allow-origin"), "*");
});

Deno.test("resposta 200 também leva CORS da origem permitida", async () => {
  const h = makeDeps();
  const res = await handleCatalogRequest(
    get(JWT_ANA, { headers: { origin: ORIGIN } }),
    h.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(res.headers.get("cache-control"), "no-store");
});

Deno.test("200 com snapshot: contrato completo, status_counts conferido", async () => {
  const h = makeDeps();
  const res = await handleCatalogRequest(get(JWT_ANA), h.deps);
  assertEquals(res.status, 200);
  const b = await body(res);
  assertEquals(b.universe_version, "seed-1");
  // ordenado por asset_id, mesmo com a fonte devolvendo fora de ordem
  assertEquals(b.assets, [
    {
      asset_id: "DEMO3",
      name: "Demo S.A. (fictícia)",
      reference_url: "https://statusinvest.com.br/acoes/demo3",
    },
    {
      asset_id: "TEST4",
      name: "Teste S.A. (fictícia)",
      reference_url: "https://statusinvest.com.br/acoes/test4",
    },
  ]);
  assertEquals(b.metrics, [
    { metric: "quote_price", label: "Cotação", unit: "BRL" },
    { metric: "price_to_book", label: "P/VP", unit: "ratio" },
    { metric: "price_to_earnings", label: "P/L", unit: "ratio" },
    { metric: "dividend_yield", label: "Dividend yield", unit: "percent" },
    { metric: "roe", label: "ROE", unit: "percent" },
  ]);
  assertEquals(b.snapshot, {
    snapshot_id: SNAPSHOT_SEED.id,
    collected_at: "2026-09-18T20:05:00+00:00",
    freshness: "fresh",
    assets_total: 2,
    assets_updated: 2,
    failures: [],
    // mesma contagem do supabase/seed.sql
    status_counts: {
      verified: 1,
      divergent: 1,
      single_source: 0,
      incomparable: 1,
      missing: 1,
      not_applicable: 0,
      invalid: 0,
    },
  });
});

Deno.test("status_counts conta cada estado e soma o total de validações", async () => {
  const statuses = [
    ...Array(3).fill("single_source"),
    ...Array(2).fill("invalid"),
    "not_applicable",
    "verified",
  ];
  const h = makeDeps({
    store: new FakeCatalogStore(
      ASSETS,
      "https://statusinvest.com.br",
      SNAPSHOT_SEED,
      statuses,
    ),
  });
  const b = await body(await handleCatalogRequest(get(JWT_ANA), h.deps));
  assertEquals(b.snapshot.status_counts, {
    verified: 1,
    divergent: 0,
    single_source: 3,
    incomparable: 0,
    missing: 0,
    not_applicable: 1,
    invalid: 2,
  });
});

Deno.test("200 sem snapshot: snapshot null, universe_version null, catálogo continua", async () => {
  const h = makeDeps({
    store: new FakeCatalogStore(ASSETS, "https://statusinvest.com.br", null),
  });
  const res = await handleCatalogRequest(get(JWT_ANA), h.deps);
  assertEquals(res.status, 200);
  const b = await body(res);
  assertEquals(b.snapshot, null);
  assertEquals(b.universe_version, null);
  assertEquals(b.assets.length, 2);
  assertEquals(b.metrics.length, 5);
});

Deno.test("snapshot sem published_at é tratado como sem snapshot", async () => {
  const h = makeDeps({
    store: new FakeCatalogStore(ASSETS, "https://statusinvest.com.br", {
      ...SNAPSHOT_SEED,
      published_at: null,
    }),
  });
  const b = await body(await handleCatalogRequest(get(JWT_ANA), h.deps));
  assertEquals(b.snapshot, null);
});

Deno.test("frescor vem do relógio injetado: fresh, stale, expired e fronteiras", async () => {
  // collected_at: sexta 2026-09-18 17:05 BRT
  const casos: [string, string][] = [
    ["2026-09-18T21:00:00Z", "fresh"],
    ["2026-09-21T15:00:00Z", "fresh"], // 1 dia útil
    ["2026-09-22T15:00:00Z", "stale"], // 2
    ["2026-09-25T15:00:00Z", "stale"], // 5
    ["2026-09-28T15:00:00Z", "expired"], // 6
    ["2026-11-16T15:00:00Z", "expired"],
    ["2026-09-18T20:00:00Z", "fresh"], // now antes da coleta, dentro da folga
    ["2026-09-18T19:59:00Z", "unknown_reference_date"], // coleta >5 min no futuro
  ];
  const h = makeDeps();
  for (const [now, esperado] of casos) {
    h.setNow(new Date(now));
    const b = await body(await handleCatalogRequest(get(JWT_ANA), h.deps));
    assertEquals(b.snapshot.freshness, esperado, now);
  }
});

Deno.test("collected_at e totais vêm do manifesto, não do relógio", async () => {
  const h = makeDeps({
    store: new FakeCatalogStore(ASSETS, "https://statusinvest.com.br", {
      ...SNAPSHOT_SEED,
      collected_at: "2026-09-17T20:05:00+00:00",
      assets_total: 12,
      assets_updated: 11,
    }),
    now: new Date("2026-09-18T21:00:00Z"),
  });
  const b = await body(await handleCatalogRequest(get(JWT_ANA), h.deps));
  assertEquals(b.snapshot.collected_at, "2026-09-17T20:05:00+00:00");
  assertEquals(b.snapshot.assets_total, 12);
  assertEquals(b.snapshot.assets_updated, 11);
});

Deno.test("failures: saneadas (sem URL com token, sem HTML, truncadas)", async () => {
  const h = makeDeps({
    store: new FakeCatalogStore(ASSETS, "https://statusinvest.com.br", {
      ...SNAPSHOT_SEED,
      failures: [
        {
          asset_id: "VALE3",
          source_id: "statusinvest",
          reason:
            "HTTP 500 em https://statusinvest.com.br/acoes/vale3?token=SEGREDO123 <html><body>Erro</body></html>",
        },
        {
          asset_id: "DEMO3",
          source_id: "fundamentus",
          reason: "x".repeat(5000),
        },
        {
          asset_id: "TEST4",
          source_id: "brapi",
          reason: "postgresql://admin:senha@db.interno:5432/prod",
        },
      ],
    }),
  });
  const res = await handleCatalogRequest(get(JWT_ANA), h.deps);
  const parsed = await res.clone().json();
  const text = JSON.stringify(parsed.snapshot.failures);
  for (
    const proibido of [
      "SEGREDO123",
      "token=",
      "https://",
      "<html>",
      "<body>",
      "senha",
      "postgresql",
    ]
  ) {
    assert(!text.includes(proibido), proibido);
  }
  const b = await body(res);
  assertEquals(b.snapshot.failures.length, 3);
  assertEquals(b.snapshot.failures[0].asset_id, "VALE3");
  assertEquals(b.snapshot.failures[0].source_id, "statusinvest");
  assert(b.snapshot.failures[0].reason.includes("HTTP 500"));
  assert(b.snapshot.failures[1].reason.length <= 200);
});

Deno.test("failures malformadas viram 500 estruturado, nunca lista vazia", async () => {
  for (
    const failures of [null, "x", [1], [{ asset_id: "A", source_id: "b" }]]
  ) {
    const h = makeDeps({
      store: new FakeCatalogStore(ASSETS, "https://statusinvest.com.br", {
        ...SNAPSHOT_SEED,
        failures,
      }),
    });
    const res = await handleCatalogRequest(get(JWT_ANA), h.deps);
    assertEquals(res.status, 500);
    const b = await body(res);
    assertEquals(b.error.code, "INTERNAL_ERROR");
    assertEquals(Object.keys(b), ["error"]);
  }
});

Deno.test("link de referência: montado no servidor; sem fonte cadastrada, nulo", async () => {
  const sem = makeDeps({ store: new FakeCatalogStore(ASSETS, null) });
  const b1 = await body(await handleCatalogRequest(get(JWT_ANA), sem.deps));
  assertEquals(
    b1.assets.map((a: { reference_url: unknown }) => a.reference_url),
    [
      null,
      null,
    ],
  );
  const http = makeDeps({
    store: new FakeCatalogStore(ASSETS, "http://statusinvest.com.br"),
  });
  const b2 = await body(await handleCatalogRequest(get(JWT_ANA), http.deps));
  assertEquals(b2.assets[0].reference_url, null);
  // nada vindo do navegador entra no link
  const h = makeDeps();
  const res = await handleCatalogRequest(
    new Request(`${URL_}?base=https://evil.test&asset_class=fii`, {
      headers: { authorization: `Bearer ${JWT_ANA}` },
    }),
    h.deps,
  );
  const b3 = await body(res);
  assertEquals(
    b3.assets[0].reference_url,
    "https://statusinvest.com.br/acoes/demo3",
  );
});

Deno.test("valores financeiros não passam por número: contagens inteiras e textos", async () => {
  const h = makeDeps();
  const text = await (await handleCatalogRequest(get(JWT_ANA), h.deps)).text();
  assert(
    !/\d\.\d+[,}\]]/.test(text.replace(/"[^"]*"/g, '""')),
    "sem decimais soltos",
  );
});

Deno.test("erro interno do banco: 500 estruturado sem vazar detalhe; log sem JWT", async () => {
  const store = new FakeCatalogStore();
  store.listAssets = () =>
    Promise.reject(new Error("select * from assets -- SEGREDO"));
  const h = makeDeps({ store });
  const res = await handleCatalogRequest(get(JWT_ANA), h.deps);
  assertEquals(res.status, 500);
  const text = await res.text();
  assert(!text.includes("SEGREDO") && !text.includes("select"));
  const log = JSON.stringify(h.logs);
  assert(!log.includes(JWT_ANA), "JWT no log");
  assertEquals(h.logs.at(-1)?.user_id, USER_ANA);
  assertEquals(h.logs.at(-1)?.event, "catalog_request");
});

Deno.test("falha do Auth (503) não vira 401 nem 200", async () => {
  const h = makeDeps();
  h.deps.authenticate = () => {
    throw Object.assign(new Error("x"), {});
  };
  const res = await handleCatalogRequest(get(JWT_ANA), h.deps);
  assertEquals(res.status, 500);
});
