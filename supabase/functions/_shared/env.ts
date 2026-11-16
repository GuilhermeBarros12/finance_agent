// Configuração do ambiente das Edge Functions (README 12.3), compartilhada.
import { parseOrigins } from "./cors.ts";

export interface EnvConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
  origins: string[];
}

// Os nomes SUPABASE_* são injetados pelo runtime das Edge Functions (README 12.3).
export function readEnv(get: (name: string) => string | undefined): EnvConfig {
  const url = get("SUPABASE_URL");
  const anonKey = get("SUPABASE_ANON_KEY") ?? get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY") ??
    get("SUPABASE_SECRET_KEY");
  if (!url || !anonKey || !serviceKey) {
    throw new Error("Configuração do Supabase ausente no ambiente da função.");
  }
  return {
    url,
    anonKey,
    serviceKey,
    origins: parseOrigins(get("APP_ORIGINS")),
  };
}
