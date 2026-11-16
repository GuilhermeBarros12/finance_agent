// Autenticação e autorização compartilhadas pelas Edge Functions (T18, T18b).
// Fluxo: bearer -> auth.getUser (assinatura, expiração, revogação) -> allowed_users
// sob RLS com o JWT do usuário. O cliente administrativo só deve existir DEPOIS disto.
// Uma chave de serviço, anon ou publishable enviada como bearer não é JWT de usuário:
// o Auth recusa e o resultado é 401 (nunca autentica como administrador).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { errors } from "./errors.ts";

// deno-lint-ignore no-explicit-any
export type Client = SupabaseClient<any, "public", any>;

export const NO_SESSION = {
  auth: { persistSession: false, autoRefreshToken: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Extrai o token do cabeçalho Authorization (esquema Bearer, um único token).
export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : null;
}

// Cliente que age com o JWT do usuário (RLS aplica).
export function userClientFor(
  url: string,
  anonKey: string,
  jwt: string,
): Client {
  return createClient(url, anonKey, {
    ...NO_SESSION,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// O Auth confere assinatura, expiração e revogação. Token inválido vira null (401);
// falha do próprio serviço vira 503, nunca "autenticado" nem "não autenticado".
export async function authenticateWith(
  client: Client,
  jwt: string,
): Promise<{ userId: string } | null> {
  const { data, error } = await client.auth.getUser(jwt);
  if (error) {
    const status = (error as { status?: number }).status;
    if (status === undefined || status === 0 || status >= 500) {
      throw errors.serviceUnavailable();
    }
    return null;
  }
  const id = data.user?.id;
  if (!id || !UUID.test(id)) return null;
  return { userId: id.toLowerCase() };
}

// Autorização: linha em allowed_users com enabled = true (lida sob RLS).
export async function isAllowedUserWith(
  db: Client,
  userId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("allowed_users")
    .select("enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`allowed_users: ${error.code ?? "erro"}`);
  return data?.enabled === true;
}
