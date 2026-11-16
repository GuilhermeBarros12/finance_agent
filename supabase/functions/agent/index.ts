// Ponto de entrada da Edge Function `agent` (POST /functions/v1/agent).
// Toda a lógica está em módulos puros e testáveis; aqui só se liga o ambiente.
// verify_jwt = false em supabase/config.toml: o JWT é verificado no código, por
// `auth.getUser`, e só depois a autorização (allowed_users) é consultada.
import { handleAgentRequest } from "./handler.ts";
import { createAgentDeps, readEnv } from "./store.ts";
import { resolveLlmConfig } from "../_shared/llm/config.ts";

const get = (name: string) => Deno.env.get(name);
// Configuração inválida (ex.: MOCK_LLM=true fora de local/test) derruba a função na
// partida, com mensagem clara: nunca cai em modo simulado em ambiente hospedado.
const deps = createAgentDeps(readEnv(get), resolveLlmConfig(get));

Deno.serve((req) => handleAgentRequest(req, deps));
