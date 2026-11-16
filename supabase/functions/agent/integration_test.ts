// Integração contra o Supabase LOCAL (T18). Roda só com SUPABASE_TEST_URL definido;
// sem ela os testes aparecem como ignorados (na CI não há Supabase local).
//
//   SUPABASE_TEST_URL=http://127.0.0.1:54321 \
//   SUPABASE_TEST_ANON_KEY=<anon/publishable local> \
//   SUPABASE_TEST_SERVICE_KEY=<service_role/secret local> \
//   deno test --allow-env --allow-read --allow-net=127.0.0.1,localhost agent/integration_test.ts
//
// Usa os dados sintéticos de supabase/seed.sql (DEMO3, TEST4) e cria usuários próprios,
// removidos no fim. As chaves vêm do ambiente; nada disto fica no repositório.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleAgentRequest } from "./handler.ts";
import { createAgentDeps } from "./store.ts";
import { canonicalBody, parseAgentRequest, sha256Hex } from "./request.ts";
import { RESERVATION_TTL_MS } from "./idempotency.ts";

const URL_ = Deno.env.get("SUPABASE_TEST_URL");
const ANON = Deno.env.get("SUPABASE_TEST_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_TEST_SERVICE_KEY") ?? "";
const enabled = Boolean(URL_ && ANON && SERVICE);

// deno-lint-ignore no-explicit-any
type Json = any;

Deno.test({
  name: "integração: POST /agent contra o Supabase local",
  ignore: !enabled,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const admin = createClient(URL_!, SERVICE, opts);
    const suffix = crypto.randomUUID().slice(0, 8);
    const password = `Senha-${crypto.randomUUID()}`;
    const created: string[] = [];

    async function newUser(name: string, allowed: boolean) {
      const email = `${name}-${suffix}@teste.invalid`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      created.push(data.user.id);
      if (allowed) {
        const r = await admin.from("allowed_users").insert({
          user_id: data.user.id,
        });
        if (r.error) throw r.error;
      }
      const client = createClient(URL_!, ANON, opts);
      const login = await client.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      return {
        id: data.user.id,
        jwt: login.data.session!.access_token,
        client,
      };
    }

    async function newConversation(u: Awaited<ReturnType<typeof newUser>>) {
      // Pelo cliente do usuário: exercita a política de insert (RLS).
      const { data, error } = await u.client.from("conversations").insert({
        user_id: u.id,
        title: "Conversa de teste T18",
      }).select("id").single();
      if (error) throw error;
      return data.id as string;
    }

    const realDeps = createAgentDeps({
      url: URL_!,
      anonKey: ANON,
      serviceKey: SERVICE,
      origins: [],
    }, { mode: "disabled" });
    let clock = () => new Date();
    const deps = { ...realDeps, now: () => clock() };

    function req(body: unknown, jwt: string | null) {
      const headers = new Headers({ "content-type": "application/json" });
      if (jwt) headers.set("authorization", `Bearer ${jwt}`);
      return new Request("http://127.0.0.1/functions/v1/agent", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }
    async function call(body: unknown, jwt: string | null) {
      const res = await handleAgentRequest(req(body, jwt), deps);
      return { res, body: (await res.json()) as Json };
    }
    async function countMessages(conversationId: string) {
      const { data, error } = await admin.from("messages").select("id")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      return data.length;
    }

    try {
      const ana = await newUser("ana", true);
      const bia = await newUser("bia", true);
      const caio = await newUser("caio", false);
      const convAna = await newConversation(ana);
      const convBia = await newConversation(bia);
      const selection = {
        asset_ids: ["DEMO3"],
        metrics: ["price_to_book", "dividend_yield"],
      };
      const bodyOf = (over: Record<string, unknown> = {}) => ({
        request_id: crypto.randomUUID(),
        conversation_id: convAna,
        selection,
        ...over,
      });

      await t.step("sem JWT e com JWT inválido: 401", async () => {
        assertEquals((await call(bodyOf(), null)).res.status, 401);
        assertEquals((await call(bodyOf(), "nao.e.jwt")).res.status, 401);
      });

      await t.step("usuário fora de allowed_users: 403", async () => {
        const r = await call(bodyOf(), caio.jwt);
        assertEquals(r.res.status, 403);
        assertEquals(r.body.error.code, "ACCESS_DENIED");
      });

      await t.step("conversa de outro dono: 404 e nada gravado", async () => {
        const body = bodyOf({ conversation_id: convBia });
        const r = await call(body, ana.jwt);
        assertEquals(r.res.status, 404);
        const runs = await admin.from("request_runs").select("id")
          .eq("request_id", body.request_id);
        assertEquals(runs.data?.length, 0);
        assertEquals(await countMessages(convBia), 0);
      });

      await t.step(
        "corpo inválido: 400 (user_id no corpo recusado)",
        async () => {
          const r = await call(bodyOf({ user_id: bia.id }), ana.jwt);
          assertEquals(r.res.status, 400);
        },
      );

      const okBody = bodyOf({ message: "Compare DEMO3" });
      let first: Json;
      await t.step(
        "sucesso: grava usuário e assistente com payload v1",
        async () => {
          const r = await call(okBody, ana.jwt);
          assertEquals(r.res.status, 200, JSON.stringify(r.body));
          first = r.body;
          assertEquals(await countMessages(convAna), 2);

          // O dono lê as duas mensagens pelo cliente dele (RLS).
          const read = await ana.client.from("messages")
            .select("id, role, sequence_no, content, payload, user_id")
            .eq("conversation_id", convAna).order("sequence_no");
          assertEquals(read.error, null);
          assertEquals(read.data!.map((m) => m.role), ["user", "assistant"]);
          assert(read.data!.every((m) => m.user_id === ana.id));
          assertEquals(read.data![0].content, "Compare DEMO3");
          const p = read.data![1].payload as Json;
          assertEquals(p.content_version, 1);
          assertEquals(p.mode, "deterministic");
          assertEquals(p.manifest, { assets_total: 2, assets_updated: 2 });

          // Divergência do seed: nenhum lado escolhido, as duas fontes na evidência,
          // valores como texto com a escala original.
          const dy = p.evidence.validations.find((v: Json) =>
            v.metric === "dividend_yield"
          );
          assertEquals(dy.status, "divergent");
          assertEquals(dy.selected_observation_id, null);
          assertEquals(dy.observation_ids.length, 2);
          assertEquals(
            p.evidence.observations
              .filter((o: Json) => o.metric === "dividend_yield")
              .map((o: Json) => o.value_decimal).sort(),
            ["8.50", "9.10"],
          );
          assertEquals(dy.comparison.delta_abs, "0.60");
          const pb = p.evidence.validations.find((v: Json) =>
            v.metric === "price_to_book"
          );
          assertEquals(pb.status, "verified");
          assert(pb.selected_observation_id);
          assertEquals(
            p.evidence.observations
              .filter((o: Json) => o.metric === "price_to_book")
              .map((o: Json) => o.value_decimal).sort(),
            ["1.50", "1.51"],
          );
          assertEquals(
            new Set(p.evidence.observations.map((o: Json) => o.source_id)),
            new Set(["fundamentus", "statusinvest"]),
          );
        },
      );

      await t.step(
        "o usuário não escreve mensagens nem execuções",
        async () => {
          const forged = await ana.client.from("messages").insert({
            conversation_id: convAna,
            user_id: ana.id,
            role: "assistant",
            sequence_no: 99,
            content: "forjada",
          });
          assert(forged.error, "o cliente não pode inserir mensagem");
          const run = await ana.client.from("request_runs").insert({
            user_id: ana.id,
            request_id: crypto.randomUUID(),
          });
          assert(run.error, "o cliente não pode inserir request_runs");
        },
      );

      await t.step(
        "repetição: mesma resposta, sem duplicar; corpo diferente: 409",
        async () => {
          const again = await call(okBody, ana.jwt);
          assertEquals(again.res.status, 200);
          assertEquals(again.res.headers.get("idempotent-replay"), "true");
          assertEquals(again.body, first);
          assertEquals(await countMessages(convAna), 2);

          const diff = await call(
            { ...okBody, message: "outra coisa" },
            ana.jwt,
          );
          assertEquals(diff.res.status, 409);
          assertEquals(diff.body.error.code, "REQUEST_CONFLICT");
          assertEquals(await countMessages(convAna), 2);
        },
      );

      await t.step(
        "em andamento: 202; reserva expirada: retomada",
        async () => {
          const body = bodyOf({ message: "em andamento" });
          const parsed = parseAgentRequest(body);
          assert(parsed.ok);
          const hash = await sha256Hex(canonicalBody(parsed.value));
          const ins = await admin.from("request_runs").insert({
            user_id: ana.id,
            request_id: body.request_id,
            conversation_id: convAna,
            body_hash: hash,
            status: "processing",
          });
          assertEquals(ins.error, null);

          const before = await countMessages(convAna);
          const busy = await call(body, ana.jwt);
          assertEquals(busy.res.status, 202);
          assertEquals(busy.body.status, "processing");
          assertEquals(await countMessages(convAna), before);

          // Relógio avançado: a reserva passa de 3 minutos e é retomada.
          clock = () => new Date(Date.now() + RESERVATION_TTL_MS + 60_000);
          const resumed = await call(body, ana.jwt);
          clock = () => new Date();
          assertEquals(resumed.res.status, 200);
          assertEquals(await countMessages(convAna), before + 2);
          const run = await admin.from("request_runs")
            .select("status, response").eq("request_id", body.request_id)
            .single();
          assertEquals(run.data?.status, "succeeded");
          assert(run.data?.response);
        },
      );

      await t.step(
        "segundo turno continua a sequência da conversa",
        async () => {
          const seq = await admin.from("messages").select("sequence_no")
            .eq("conversation_id", convAna).order("sequence_no");
          const nums = seq.data!.map((m) => m.sequence_no);
          assertEquals(nums, nums.map((_, i) => i + 1));
        },
      );

      await t.step("ativo fora do universo: 422", async () => {
        const body = bodyOf({
          selection: { asset_ids: ["DEMO3", "ZZZZ9"], metrics: ["roe"] },
        });
        const r = await call(body, ana.jwt);
        assertEquals(r.res.status, 422);
        assertEquals(r.body.error.code, "UNSUPPORTED_ASSET");
        const run = await admin.from("request_runs").select("status, error")
          .eq("request_id", body.request_id).single();
        assertEquals(run.data, {
          status: "failed",
          error: "UNSUPPORTED_ASSET",
        });
      });

      await t.step(
        "missing e incomparable do seed ficam como limitação",
        async () => {
          const r = await call(
            bodyOf({
              selection: {
                asset_ids: ["TEST4"],
                metrics: ["price_to_earnings", "roe"],
              },
            }),
            ana.jwt,
          );
          assertEquals(r.res.status, 200, JSON.stringify(r.body));
          const p = r.body.payload;
          assertEquals(p.sections.length, 1);
          assertEquals(p.sections[0].kind, "limitation");
          const statuses = p.evidence.validations.map((v: Json) => v.status)
            .sort();
          assertEquals(statuses, ["incomparable", "missing"]);
          assertEquals(r.body.coverage.status, "partial");
        },
      );

      await t.step("sem snapshot ativo: 503 DATA_UNAVAILABLE", async () => {
        const ptr = await admin.from("active_snapshot").select("*").single();
        assertEquals(ptr.error, null);
        const del = await admin.from("active_snapshot").delete()
          .eq("universe", ptr.data!.universe);
        assertEquals(del.error, null);
        try {
          const r = await call(bodyOf(), ana.jwt);
          assertEquals(r.res.status, 503);
          assertEquals(r.body.error.code, "DATA_UNAVAILABLE");
        } finally {
          const back = await admin.from("active_snapshot").insert({
            universe: ptr.data!.universe,
            snapshot_id: ptr.data!.snapshot_id,
          });
          assertEquals(back.error, null);
        }
      });
    } finally {
      for (const id of created) await admin.auth.admin.deleteUser(id);
    }
  },
});
