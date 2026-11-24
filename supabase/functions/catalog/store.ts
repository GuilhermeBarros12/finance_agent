// Acesso real ao Supabase para GET /catalog. Cliente com o JWT do usuário para
// autorizar (allowed_users sob RLS); cliente administrativo (service_role) para ler
// o mercado, e só DEPOIS de autenticar e autorizar. Nada é escrito aqui.
import { createClient } from "@supabase/supabase-js";
import {
  authenticateWith,
  type Client,
  isAllowedUserWith,
  NO_SESSION,
  userClientFor,
} from "../_shared/auth.ts";
import type { EnvConfig } from "../_shared/env.ts";
import { VALIDATION_STATUSES } from "../_shared/schemas.ts";
import type {
  CatalogAssetRow,
  CatalogDeps,
  CatalogSnapshotRow,
  CatalogStore,
  StatusCounts,
  UserStore,
} from "./types.ts";

// Fonte do link de referência para consulta manual (README 7.8).
export const REFERENCE_SOURCE_CODE = "statusinvest";

class SupabaseUserStore implements UserStore {
  constructor(private readonly db: Client) {}
  isAllowedUser(userId: string): Promise<boolean> {
    return isAllowedUserWith(this.db, userId);
  }
  // Não usado por /catalog; a interface é a do agente.
  ownsConversation(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class SupabaseCatalogStore implements CatalogStore {
  constructor(private readonly db: Client) {}

  async listAssets(): Promise<CatalogAssetRow[]> {
    const { data, error } = await this.db
      .from("assets")
      .select("id,symbol,asset_class,name")
      .eq("asset_class", "stock")
      .order("symbol", { ascending: true });
    if (error) throw new Error(`assets: ${error.code ?? "erro"}`);
    return (data ?? []) as CatalogAssetRow[];
  }

  async referenceBaseUrl(): Promise<string | null> {
    const { data, error } = await this.db
      .from("data_sources")
      .select("base_url")
      .eq("code", REFERENCE_SOURCE_CODE)
      .eq("enabled", true)
      .maybeSingle();
    if (error) throw new Error(`data_sources: ${error.code ?? "erro"}`);
    return (data?.base_url as string | undefined) ?? null;
  }

  async activeSnapshot(universe: string): Promise<CatalogSnapshotRow | null> {
    const pointer = await this.db
      .from("active_snapshot")
      .select("snapshot_id")
      .eq("universe", universe)
      .maybeSingle();
    if (pointer.error) throw new Error("active_snapshot");
    if (!pointer.data) return null;
    const snap = await this.db
      .from("snapshots")
      .select(
        "id,collected_at,universe_version,assets_total,assets_updated,published_at,failures",
      )
      .eq("id", pointer.data.snapshot_id)
      .maybeSingle();
    if (snap.error) throw new Error("snapshots");
    return (snap.data as CatalogSnapshotRow | null) ?? null;
  }

  // Uma contagem exata por estado; evita o limite de linhas do PostgREST.
  async statusCounts(snapshotId: string): Promise<StatusCounts> {
    const entries = await Promise.all(
      VALIDATION_STATUSES.map(async (status) => {
        const { count, error } = await this.db
          .from("field_validations")
          .select("id", { count: "exact", head: true })
          .eq("snapshot_id", snapshotId)
          .eq("status", status);
        if (error) {
          throw new Error(`field_validations: ${error.code ?? "erro"}`);
        }
        if (count === null) throw new Error("field_validations: sem contagem");
        return [status, count] as const;
      }),
    );
    return Object.fromEntries(entries) as StatusCounts;
  }
}

export function createCatalogDeps(env: EnvConfig): CatalogDeps {
  const anon: Client = createClient(env.url, env.anonKey, NO_SESSION);
  const admin: Client = createClient(env.url, env.serviceKey, NO_SESSION);
  return {
    authenticate: (jwt) => authenticateWith(anon, jwt),
    userStore: (jwt) =>
      new SupabaseUserStore(userClientFor(env.url, env.anonKey, jwt)),
    store: new SupabaseCatalogStore(admin),
    now: () => new Date(),
    allowedOrigins: env.origins,
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}
