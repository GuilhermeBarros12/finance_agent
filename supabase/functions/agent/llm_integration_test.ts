// Integração do classificador (T19) contra o Supabase LOCAL: contador global atômico,
// permissões da RPC e POST /agent só com `message`. Roda só com SUPABASE_TEST_URL definido
// (ver agent/integration_test.ts). O provedor é SEMPRE um fetch falso: não há chamada à Groq.
// O contador usa um provedor próprio (`t19-<sufixo>`) e apaga a linha no fim.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleAgentRequest } from "./handler.ts";
import { createAgentDeps, SupabaseQuotaStore } from "./store.ts";
import { createLlmService } from "../_shared/llm/service.ts";
import { FakeProvider, groqReply } from "../_shared/llm/fakes.ts";

const URL_ = Deno.env.get("SUPABASE_TEST_URL");
const ANON = Deno.env.get("SUPABASE_TEST_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_TEST_SERVICE_KEY") ?? "";
const enabled = Boolean(URL_ && ANON && SERVICE);

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.test({
  name: "integração T19: cota atômica e POST /agent só com message",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    // O fetch global fica intacto: o supabase-js o usa para falar com o Supabase LOCAL.
    // O provedor de LLM é sempre o dublê injetado, e --allow-net só libera localhost.
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(URL_!, SERVICE, opts);
    const suffix = crypto.randomUUID().slice(0, 8);
    const provider = `t19-${suffix}`;
    const password = `Senha-${crypto.randomUUID()}`;
    const created: string[] = [];

    try {
      await t.step(
        "N chamadas simultâneas nunca passam do limite",
        async () => {
          const limit = 7;
          const results = await Promise.all(
            Array.from({ length: 40 }, () =>
              admin.rpc("consume_llm_quota", {
                p_provider: provider,
                p_limit: limit,
              })),
          );
          for (const r of results) {
            assertEquals(r.error, null);
          }
          const granted = results.filter((r) => r.data === true).length;
          assertEquals(granted, limit);
          const row = await admin.from("llm_usage").select("request_count")
            .eq("provider", provider).single();
          assertEquals(row.data?.request_count, limit);
        },
      );

      await t.step("anon e authenticated não executam a RPC", async () => {
        const anon = createClient(URL_!, ANON, opts);
        const a = await anon.rpc("consume_llm_quota", {
          p_provider: provider,
          p_limit: 99,
        });
        assert(a.error, "anon deveria ser negado");
        assertEquals(a.error?.code, "42501");

        const email = `t19-${suffix}@teste.invalid`;
        const u = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (u.error) throw u.error;
        created.push(u.data.user.id);
        const client = createClient(URL_!, ANON, opts);
        const login = await client.auth.signInWithPassword({ email, password });
        if (login.error) throw login.error;
        const b = await client.rpc("consume_llm_quota", {
          p_provider: provider,
          p_limit: 99,
        });
        assertEquals(b.error?.code, "42501");
        const row = await admin.from("llm_usage").select("request_count")
          .eq("provider", provider).single();
        assertEquals(row.data?.request_count, 7);
      });

      await t.step(
        "POST /agent só com message, cota real e replay",
        async () => {
          const email = `t19b-${suffix}@teste.invalid`;
          const u = await admin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
          if (u.error) throw u.error;
          const userId = u.data.user.id;
          created.push(userId);
          const ins = await admin.from("allowed_users").insert({
            user_id: userId,
          });
          assertEquals(ins.error, null);
          const client = createClient(URL_!, ANON, opts);
          const login = await client.auth.signInWithPassword({
            email,
            password,
          });
          if (login.error) throw login.error;
          const jwt = login.data.session!.access_token;
          const conv = await client.from("conversations").insert({
            user_id: userId,
            title: "T19",
          }).select("id").single();
          assertEquals(conv.error, null);

          const fake = new FakeProvider([
            groqReply(JSON.stringify({
              intent: "compare",
              asset_ids: ["DEMO3"],
              metrics: ["dividend_yield"],
            })),
            groqReply("lixo"),
          ]);
          const quota = new SupabaseQuotaStore(admin);
          const base = createAgentDeps(
            { url: URL_!, anonKey: ANON, serviceKey: SERVICE, origins: [] },
            { mode: "disabled" },
          );
          // Provedor de cota próprio do teste; o limite 1 deixa só a primeira chamada passar.
          const cfg = {
            mode: "groq" as const,
            apiKey: "k",
            model: "m",
            dailyLimit: 1,
          };
          const deps = {
            ...base,
            llm: createLlmService({
              config: cfg,
              fetch: fake.fetch,
              consumeQuota: (_p, limit) =>
                quota.consume(`${provider}-e`, limit),
            }),
          };
          const send = async (body: unknown) => {
            const res = await handleAgentRequest(
              new Request("http://127.0.0.1/functions/v1/agent", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify(body),
              }),
              deps,
            );
            return { res, body: (await res.json()) as Json };
          };
          const r1id = crypto.randomUUID();
          const msg = {
            conversation_id: conv.data!.id,
            message: "dividend yield de DEMO3",
          };
          const first = await send({ request_id: r1id, ...msg });
          assertEquals(first.res.status, 200);
          assertEquals(first.body.status, "completed");
          assertEquals(first.body.intent_source, "llm");
          assertEquals(
            first.body.payload.evidence.validations[0].status,
            "divergent",
          );

          const replay = await send({ request_id: r1id, ...msg });
          assertEquals(replay.res.headers.get("idempotent-replay"), "true");
          assertEquals(replay.body, first.body);
          assertEquals(fake.calls.length, 1);

          // Novo pedido: o limite (1) já foi consumido, então não chama o provedor.
          const r2id = crypto.randomUUID();
          const second = await send({ request_id: r2id, ...msg });
          assertEquals(second.res.status, 200);
          assertEquals(second.body.status, "needs_selection");
          assertEquals(second.body.reason.code, "LLM_QUOTA_EXHAUSTED");
          assertEquals(fake.calls.length, 1);
          const replay2 = await send({ request_id: r2id, ...msg });
          assertEquals(replay2.body, second.body);
          assertEquals(fake.calls.length, 1);

          const row = await admin.from("llm_usage").select("request_count")
            .eq("provider", `${provider}-e`).single();
          assertEquals(row.data?.request_count, 1);

          // needs_selection não grava mensagem: só as duas do primeiro pedido.
          const msgs = await admin.from("messages").select("id")
            .eq("conversation_id", conv.data!.id);
          assertEquals(msgs.data?.length, 2);
        },
      );

      await t.step("modo simulado com universo real do banco", async () => {
        const base = createAgentDeps(
          { url: URL_!, anonKey: ANON, serviceKey: SERVICE, origins: [] },
          { mode: "mock" },
        );
        const symbols = await base.market.listStockSymbols();
        assert(symbols.includes("DEMO3") && symbols.includes("TEST4"));
        const out = await base.llm.classify("qualquer", symbols);
        assertEquals(out.ok && out.selection.asset_ids, ["DEMO3"]);
      });
    } finally {
      await admin.from("llm_usage").delete().in("provider", [
        provider,
        `${provider}-e`,
      ]);
      for (const id of created) await admin.auth.admin.deleteUser(id);
    }
  },
});
