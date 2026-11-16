// Integração contra o Supabase LOCAL (T18b). Roda só com SUPABASE_TEST_URL definido;
// sem ela os testes aparecem como ignorados (na CI não há Supabase local).
//
//   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
//   SUPABASE_TEST_ANON_KEY=<anon/publishable local> \
//   SUPABASE_TEST_SERVICE_KEY=<service_role/secret local> \
//   deno test --allow-env --allow-read --allow-net=127.0.0.1,localhost catalog/integration_test.ts
//
// Usa os dados sintéticos de supabase/seed.sql (DEMO3, TEST4) e cria usuários próprios,
// removidos no fim. As chaves vêm do ambiente; nada disto fica no repositório.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleCatalogRequest } from "./handler.ts";
import { createCatalogDeps } from "./store.ts";

const URL_ = Deno.env.get("SUPABASE_TEST_URL");
const ANON = Deno.env.get("SUPABASE_TEST_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_TEST_SERVICE_KEY") ?? "";
const enabled = Boolean(URL_ && ANON && SERVICE);

const SEED_SNAPSHOT = "d0000000-0000-4000-8000-000000000001";

Deno.test({
  name: "integração: GET /catalog contra o Supabase local",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(URL_!, SERVICE, opts);
    const suffix = crypto.randomUUID().slice(0, 8);
    const password = `Senha-${crypto.randomUUID()}`;
    const created: string[] = [];

    async function newUser(name: string, allowed: boolean | null) {
      const email = `${name}-${suffix}@teste.invalid`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      created.push(data.user.id);
      if (allowed !== null) {
        const r = await admin.from("allowed_users").insert({
          user_id: data.user.id,
          enabled: allowed,
        });
        if (r.error) throw r.error;
      }
      const client = createClient(URL_!, ANON, opts);
      const login = await client.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      return login.data.session!.access_token;
    }

    const realDeps = createCatalogDeps({
      url: URL_!,
      anonKey: ANON,
      serviceKey: SERVICE,
      origins: ["https://app.example.test"],
    });
    let clock = () => new Date("2026-09-18T21:00:00Z");
    const deps = { ...realDeps, now: () => clock() };
    const call = (jwt?: string, method = "GET") =>
      handleCatalogRequest(
        new Request("http://localhost/catalog", {
          method,
          headers: jwt ? { authorization: `Bearer ${jwt}` } : {},
        }),
        deps,
      );

    try {
      const ana = await newUser("ana", true);
      const caio = await newUser("caio", null);
      const desab = await newUser("desab", false);

      await t.step(
        "401: sem JWT, chave de serviço e chave anon como bearer",
        async () => {
          for (const jwt of [undefined, SERVICE, ANON, "lixo.lixo.lixo"]) {
            const res = await call(jwt);
            assertEquals(res.status, 401);
            assertEquals((await res.json()).error.code, "UNAUTHENTICATED");
          }
        },
      );

      await t.step("403: fora de allowed_users e desabilitado", async () => {
        for (const jwt of [caio, desab]) {
          const res = await call(jwt);
          assertEquals(res.status, 403);
          assertEquals((await res.json()).error.code, "ACCESS_DENIED");
        }
      });

      await t.step("405 para POST", async () => {
        assertEquals((await call(ana, "POST")).status, 405);
      });

      await t.step(
        "200 com o snapshot do seed: status_counts bate com o seed",
        async () => {
          const res = await call(ana);
          assertEquals(res.status, 200);
          const b = await res.json();
          const active = await admin.from("active_snapshot").select(
            "snapshot_id",
          )
            .eq("universe", "stocks").single();
          assertEquals(b.snapshot.snapshot_id, active.data!.snapshot_id);

          // Contagem independente, direto na tabela, sobre o mesmo snapshot.
          const rows = await admin.from("field_validations").select("status")
            .eq("snapshot_id", b.snapshot.snapshot_id);
          const expected: Record<string, number> = {
            verified: 0,
            divergent: 0,
            single_source: 0,
            incomparable: 0,
            missing: 0,
            not_applicable: 0,
            invalid: 0,
          };
          for (const r of rows.data!) expected[r.status as string]++;
          assertEquals(b.snapshot.status_counts, expected);

          if (b.snapshot.snapshot_id === SEED_SNAPSHOT) {
            // supabase/seed.sql: uma validação em cada um destes quatro estados.
            assertEquals(b.snapshot.status_counts, {
              verified: 1,
              divergent: 1,
              single_source: 0,
              incomparable: 1,
              missing: 1,
              not_applicable: 0,
              invalid: 0,
            });
            assertEquals(b.universe_version, "seed-1");
            assertEquals(b.snapshot.assets_total, 2);
            assertEquals(b.snapshot.assets_updated, 2);
            assertEquals(b.snapshot.failures, []);
            assertEquals(b.snapshot.freshness, "fresh");
            assertEquals(b.snapshot.collected_at, "2026-09-18T20:05:00+00:00");
          }
          const ids = b.assets.map((a: { asset_id: string }) => a.asset_id);
          assertEquals(ids, [...ids].sort());
          for (const a of b.assets) {
            assert(
              a.reference_url === null ||
                a.reference_url ===
                  `https://statusinvest.com.br/acoes/${a.asset_id.toLowerCase()}`,
            );
          }
          assertEquals(b.metrics.length, 5);
        },
      );

      await t.step("frescor acompanha o relógio injetado", async () => {
        clock = () => new Date("2026-11-16T15:00:00Z");
        const b = await (await call(ana)).json();
        if (b.snapshot.snapshot_id === SEED_SNAPSHOT) {
          assertEquals(b.snapshot.freshness, "expired");
        }
      });
    } finally {
      for (const id of created) await admin.auth.admin.deleteUser(id);
    }
  },
});
