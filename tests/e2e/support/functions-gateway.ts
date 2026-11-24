// Gateway local dos testes ponta a ponta (T21f). Roda em Deno.
//
// Faz o papel do gateway de funções do Supabase, com os handlers REAIS de
// supabase/functions/agent e supabase/functions/catalog contra o banco local:
//   - /functions/v1/agent e /functions/v1/catalog: chamam os handlers (CORS incluído);
//   - qualquer outro caminho (REST, Auth): repassado ao Supabase local (SUPABASE_URL),
//     para que o navegador fale com UM endereço, como falaria com o projeto hospedado;
//   - /__e2e/llm-mode: controle SÓ de teste, escuta em 127.0.0.1. Alterna o agente entre o
//     classificador simulado (MOCK_LLM=true) e o LLM desligado (sem chave: LLM_DISABLED),
//     que é o caminho real do needs_selection quando não há LLM.
//
// Por que não `supabase functions serve`: neste ambiente de desenvolvimento o contêiner
// do edge runtime não consegue baixar o supabase-js pelo proxy de rede (UnknownIssuer).
// Em máquina sem esse limite, `functions serve` serviria o mesmo propósito (docs/tarefas/T21f.md).
//
// Ambiente (nenhum valor é fixo aqui; o playwright.config.ts lê do `supabase status`):
//   GATEWAY_PORT, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   APP_ORIGINS, APP_ENV=local, MOCK_LLM=true.
import { handleAgentRequest } from "../../../supabase/functions/agent/handler.ts";
import { createAgentDeps } from "../../../supabase/functions/agent/store.ts";
import { handleCatalogRequest } from "../../../supabase/functions/catalog/handler.ts";
import { createCatalogDeps } from "../../../supabase/functions/catalog/store.ts";
import { readEnv } from "../../../supabase/functions/_shared/env.ts";
import { resolveLlmConfig } from "../../../supabase/functions/_shared/llm/config.ts";

const get = (name: string) => Deno.env.get(name);
const env = readEnv(get);
const port = Number(get("GATEWAY_PORT") ?? "54331");
const upstream = env.url.replace(/\/+$/, "");

// Mesma validação de produção: MOCK_LLM=true só passa com APP_ENV=local|test.
const mockConfig = resolveLlmConfig(get);
const disabledConfig = resolveLlmConfig((name) =>
  name === "APP_ENV" ? get("APP_ENV") : undefined
);
if (mockConfig.mode !== "mock") {
  throw new Error("O gateway de teste exige MOCK_LLM=true e APP_ENV=local.");
}
if (disabledConfig.mode !== "disabled") {
  throw new Error("Configuração sem chave deveria resultar em LLM desligado.");
}

const agentDeps = {
  mock: createAgentDeps(env, mockConfig),
  disabled: createAgentDeps(env, disabledConfig),
};
const catalogDeps = createCatalogDeps(env);
let llmMode: "mock" | "disabled" = "mock";

const HOP = ["host", "connection", "content-length", "accept-encoding"];

async function proxy(req: Request, url: URL): Promise<Response> {
  const headers = new Headers(req.headers);
  for (const name of HOP) headers.delete(name);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await fetch(`${upstream}${url.pathname}${url.search}`, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
  });
  const out = new Headers(response.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: out,
  });
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/__e2e/llm-mode") {
    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (body?.mode !== "mock" && body?.mode !== "disabled") {
        return new Response("modo inválido", { status: 400 });
      }
      llmMode = body.mode;
    }
    return Response.json({ mode: llmMode });
  }
  if (url.pathname === "/functions/v1/agent") {
    return handleAgentRequest(req, agentDeps[llmMode]);
  }
  if (url.pathname === "/functions/v1/catalog") {
    return handleCatalogRequest(req, catalogDeps);
  }
  if (url.pathname.startsWith("/functions/v1/")) {
    return new Response("função inexistente", { status: 404 });
  }
  return proxy(req, url);
}

Deno.serve({ hostname: "127.0.0.1", port }, async (req) => {
  try {
    return await route(req);
  } catch (error) {
    console.error("gateway:", error instanceof Error ? error.name : "erro");
    return new Response("erro no gateway de teste", { status: 502 });
  }
});
