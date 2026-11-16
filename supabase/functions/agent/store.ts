// Acesso real ao Supabase. Dois clientes, com papéis distintos (README 8.4):
//  - cliente com o JWT do usuário: dados privados lidos sob RLS (allowed_users, conversations);
//  - cliente administrativo (service_role): tabelas de mercado e escritas de sistema
//    (request_runs, messages do assistente). Só é usado DEPOIS de autenticar e
//    autorizar, e o user_id sempre vem do JWT.
// Numéricos saem como texto (`::text`): PostgREST devolveria número JSON (float).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { errors } from "./errors.ts";
import type {
  AgentDeps,
  AssetRow,
  MarketStore,
  NewRun,
  ObservationRow,
  RunRow,
  SnapshotRow,
  SystemStore,
  TurnInput,
  UserStore,
  ValidationRow,
} from "./types.ts";
import { parseOrigins } from "./cors.ts";
import { sha256Hex } from "./request.ts";

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, "public", any>;

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

const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };

export function createAgentDeps(env: EnvConfig): AgentDeps {
  const anon: Client = createClient(env.url, env.anonKey, NO_SESSION);
  const admin: Client = createClient(env.url, env.serviceKey, NO_SESSION);
  return {
    authenticate: (jwt) => authenticateWith(anon, jwt),
    userStore: (jwt) => new SupabaseUserStore(userClient(env, jwt)),
    system: new SupabaseSystemStore(admin),
    market: new SupabaseMarketStore(admin),
    now: () => new Date(),
    sha256Hex,
    allowedOrigins: env.origins,
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}

function userClient(env: EnvConfig, jwt: string): Client {
  return createClient(env.url, env.anonKey, {
    ...NO_SESSION,
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export class SupabaseUserStore implements UserStore {
  constructor(private readonly db: Client) {}

  async isAllowedUser(userId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("allowed_users")
      .select("enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`allowed_users: ${error.code ?? "erro"}`);
    return data?.enabled === true;
  }

  async ownsConversation(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    const { data, error } = await this.db
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`conversations: ${error.code ?? "erro"}`);
    return data != null;
  }
}

const RUN_COLUMNS = "id,status,body_hash,response,updated_at";

export class SupabaseSystemStore implements SystemStore {
  constructor(private readonly db: Client) {}

  async insert(run: NewRun) {
    const { data, error } = await this.db
      .from("request_runs")
      .insert({ ...run, status: "processing" })
      .select(RUN_COLUMNS)
      .single();
    if (!error) return { ok: true as const, run: data as RunRow };
    if (error.code === "23505") {
      return { ok: false as const, reason: "duplicate" as const };
    }
    // FK composta (conversation_id, user_id): conversa inexistente ou de outro dono.
    if (error.code === "23503") {
      return { ok: false as const, reason: "conversation_missing" as const };
    }
    throw new Error(`request_runs.insert: ${error.code ?? "erro"}`);
  }

  async find(userId: string, requestId: string): Promise<RunRow | null> {
    const { data, error } = await this.db
      .from("request_runs")
      .select(RUN_COLUMNS)
      .eq("user_id", userId)
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) throw new Error(`request_runs.find: ${error.code ?? "erro"}`);
    return (data as RunRow | null) ?? null;
  }

  async takeOver(
    id: string,
    from: "processing" | "failed",
    staleBefore: string,
  ): Promise<boolean> {
    // Atômico: o trigger de updated_at move a data ao vencedor, então um segundo
    // candidato já não satisfaz `updated_at < staleBefore`.
    let query = this.db
      .from("request_runs")
      .update({ status: "processing", error: null })
      .eq("id", id)
      .eq("status", from);
    if (from === "processing") query = query.lt("updated_at", staleBefore);
    const { data, error } = await query.select("id");
    if (error) {
      throw new Error(`request_runs.takeOver: ${error.code ?? "erro"}`);
    }
    return (data?.length ?? 0) === 1;
  }

  async complete(id: string, response: unknown): Promise<void> {
    const { error } = await this.db
      .from("request_runs")
      .update({ status: "succeeded", response, error: null })
      .eq("id", id)
      .eq("status", "processing");
    if (error) {
      throw new Error(`request_runs.complete: ${error.code ?? "erro"}`);
    }
  }

  async fail(id: string, code: string): Promise<void> {
    const { error } = await this.db
      .from("request_runs")
      .update({ status: "failed", error: code })
      .eq("id", id)
      .eq("status", "processing");
    if (error) throw new Error(`request_runs.fail: ${error.code ?? "erro"}`);
  }

  async persistTurn(turn: TurnInput): Promise<void> {
    const ids = [turn.user_message_id, turn.assistant_message_id];
    for (let attempt = 0; attempt < 5; attempt++) {
      // Os ids são derivados de (user_id, request_id): se já existem, o turno foi
      // gravado por uma execução anterior e não há o que repetir.
      const existing = await this.db.from("messages").select("id").in(
        "id",
        ids,
      );
      if (existing.error) throw new Error("messages.select");
      const count = existing.data?.length ?? 0;
      if (count === 2) return;
      if (count !== 0) throw new Error("turno gravado pela metade");

      const last = await this.db
        .from("messages")
        .select("sequence_no")
        .eq("conversation_id", turn.conversation_id)
        .order("sequence_no", { ascending: false })
        .limit(1);
      if (last.error) throw new Error("messages.sequence");
      const next = ((last.data?.[0]?.sequence_no as number | undefined) ?? 0) +
        1;

      // Um único INSERT com as duas linhas: ou entram as duas ou nenhuma.
      const { error } = await this.db.from("messages").insert([
        {
          id: turn.user_message_id,
          conversation_id: turn.conversation_id,
          user_id: turn.user_id,
          role: "user",
          sequence_no: next,
          content: turn.user_content,
          content_version: 1,
          payload: null,
        },
        {
          id: turn.assistant_message_id,
          conversation_id: turn.conversation_id,
          user_id: turn.user_id,
          role: "assistant",
          sequence_no: next + 1,
          content: turn.assistant_content,
          content_version: 1,
          payload: turn.payload,
        },
      ]);
      if (!error) return;
      // 23505: outro turno da mesma conversa tomou o número; recalcula e tenta de novo.
      if (error.code !== "23505") {
        throw new Error(`messages.insert: ${error.code}`);
      }
    }
    throw new Error("messages.insert: conflito de sequência persistente");
  }
}

const VALIDATION_COLUMNS = "id,snapshot_id,asset_id,metric,status,freshness," +
  "selected_observation_id,observation_ids," +
  "delta_abs:delta_abs::text,limit_value:limit_value::text," +
  "atol:atol::text,rtol:rtol::text,tolerance_version,reason";

const OBSERVATION_COLUMNS = "id,snapshot_id,asset_id,metric,raw_value," +
  "value_decimal:value_decimal::text,unit,currency,period_start,period_end," +
  "reference_at,reference_date,collected_at,source_url,upstream_source," +
  "methodology_id,run_id,parser_version,raw_content_hash,data_sources(code)";

export class SupabaseMarketStore implements MarketStore {
  constructor(private readonly db: Client) {}

  async findAssets(symbols: string[]): Promise<AssetRow[]> {
    const { data, error } = await this.db
      .from("assets")
      .select("id,symbol,asset_class")
      .in("symbol", symbols);
    if (error) throw new Error(`assets: ${error.code ?? "erro"}`);
    return (data ?? []) as AssetRow[];
  }

  async activeSnapshot(universe: string): Promise<SnapshotRow | null> {
    const pointer = await this.db
      .from("active_snapshot")
      .select("snapshot_id")
      .eq("universe", universe)
      .maybeSingle();
    if (pointer.error) throw new Error("active_snapshot");
    if (!pointer.data) return null;
    const snap = await this.db
      .from("snapshots")
      .select("id,collected_at,assets_total,assets_updated,published_at")
      .eq("id", pointer.data.snapshot_id)
      .maybeSingle();
    if (snap.error) throw new Error("snapshots");
    return (snap.data as SnapshotRow | null) ?? null;
  }

  async loadValidations(
    snapshotId: string,
    assetIds: string[],
    metrics: string[],
  ): Promise<ValidationRow[]> {
    const { data, error } = await this.db
      .from("field_validations")
      .select(VALIDATION_COLUMNS)
      .eq("snapshot_id", snapshotId)
      .in("asset_id", assetIds)
      .in("metric", metrics);
    if (error) throw new Error(`field_validations: ${error.code ?? "erro"}`);
    return (data ?? []) as unknown as ValidationRow[];
  }

  async loadObservations(
    snapshotId: string,
    assetIds: string[],
    metrics: string[],
  ): Promise<ObservationRow[]> {
    const { data, error } = await this.db
      .from("observations")
      .select(OBSERVATION_COLUMNS)
      .eq("snapshot_id", snapshotId)
      .in("asset_id", assetIds)
      .in("metric", metrics);
    if (error) throw new Error(`observations: ${error.code ?? "erro"}`);
    return ((data ?? []) as unknown as (ObservationRow & {
      data_sources: { code: string } | null;
    })[]).map((row) => {
      const { data_sources, ...rest } = row;
      if (!data_sources?.code) throw new Error("observação sem fonte");
      return { ...rest, source_code: data_sources.code };
    });
  }
}
