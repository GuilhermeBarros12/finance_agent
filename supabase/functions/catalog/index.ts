// Ponto de entrada da Edge Function `catalog` (GET /functions/v1/catalog).
// verify_jwt = false em supabase/config.toml: o JWT é verificado no código, por
// `auth.getUser`, e só depois a autorização (allowed_users) é consultada.
import { readEnv } from "../_shared/env.ts";
import { handleCatalogRequest } from "./handler.ts";
import { createCatalogDeps } from "./store.ts";

const deps = createCatalogDeps(readEnv((name) => Deno.env.get(name)));

Deno.serve((req) => handleCatalogRequest(req, deps));
