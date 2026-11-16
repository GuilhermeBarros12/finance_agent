// Ponto de entrada da Edge Function `agent` (POST /functions/v1/agent).
// Toda a lógica está em módulos puros e testáveis; aqui só se liga o ambiente.
// verify_jwt = false em supabase/config.toml: o JWT é verificado no código, por
// `auth.getUser`, e só depois a autorização (allowed_users) é consultada.
import { handleAgentRequest } from "./handler.ts";
import { createAgentDeps, readEnv } from "./store.ts";

const deps = createAgentDeps(readEnv((name) => Deno.env.get(name)));

Deno.serve((req) => handleAgentRequest(req, deps));
