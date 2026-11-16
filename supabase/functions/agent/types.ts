// Contratos internos entre o handler (puro) e os acessos ao banco (injetados).
// As linhas de mercado vêm com numéricos já como TEXTO (cast `::text` na consulta):
// um `numeric` lido como número JSON passaria por float e perderia escala.

export interface AssetRow {
  id: string;
  symbol: string;
  asset_class: string;
}

export interface SnapshotRow {
  id: string;
  collected_at: string;
  assets_total: number;
  assets_updated: number;
  published_at: string | null;
}

export interface ValidationRow {
  id: string;
  snapshot_id: string;
  asset_id: string;
  metric: string;
  status: string;
  freshness: string;
  selected_observation_id: string | null;
  observation_ids: string[];
  delta_abs: string | null;
  limit_value: string | null;
  atol: string | null;
  rtol: string | null;
  tolerance_version: string | null;
  reason: string | null;
}

export interface ObservationRow {
  id: string;
  snapshot_id: string;
  asset_id: string;
  source_code: string;
  metric: string;
  raw_value: string;
  value_decimal: string;
  unit: string;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  reference_at: string | null;
  reference_date: string | null;
  collected_at: string;
  source_url: string;
  upstream_source: string | null;
  methodology_id: string;
  run_id: string;
  parser_version: string;
  raw_content_hash: string;
}

export interface RunRow {
  id: string;
  status: "processing" | "succeeded" | "failed";
  body_hash: string | null;
  response: unknown;
  updated_at: string;
}

export interface NewRun {
  user_id: string;
  request_id: string;
  conversation_id: string;
  body_hash: string;
}

// Acesso mínimo a request_runs (cliente administrativo). A lógica de idempotência
// fica em idempotency.ts e só conversa com esta interface.
export interface RunRepo {
  insert(
    run: NewRun,
  ): Promise<
    | { ok: true; run: RunRow }
    | { ok: false; reason: "duplicate" | "conversation_missing" }
  >;
  find(userId: string, requestId: string): Promise<RunRow | null>;
  // Passa a reserva de `processing` (parada antes de `staleBefore`) ou de `failed`
  // para `processing`, de forma atômica. Falso quando outra execução chegou antes.
  takeOver(
    id: string,
    from: "processing" | "failed",
    staleBefore: string,
  ): Promise<boolean>;
  complete(id: string, response: unknown): Promise<void>;
  fail(id: string, code: string): Promise<void>;
}

export interface TurnInput {
  conversation_id: string;
  user_id: string;
  user_message_id: string;
  assistant_message_id: string;
  user_content: string;
  assistant_content: string;
  payload: unknown;
}

export interface SystemStore extends RunRepo {
  // Grava a mensagem do usuário e a do assistente, ou nada. Repetir com os mesmos
  // ids não duplica.
  persistTurn(turn: TurnInput): Promise<void>;
}

// Dados privados lidos com o JWT do usuário (RLS).
export interface UserStore {
  isAllowedUser(userId: string): Promise<boolean>;
  ownsConversation(userId: string, conversationId: string): Promise<boolean>;
}

// Dados de mercado (cliente administrativo; o navegador não tem acesso).
export interface MarketStore {
  findAssets(symbols: string[]): Promise<AssetRow[]>;
  activeSnapshot(universe: string): Promise<SnapshotRow | null>;
  loadValidations(
    snapshotId: string,
    assetIds: string[],
    metrics: string[],
  ): Promise<ValidationRow[]>;
  loadObservations(
    snapshotId: string,
    assetIds: string[],
    metrics: string[],
  ): Promise<ObservationRow[]>;
}

export interface LogEntry {
  event: string;
  status: number;
  code?: string;
  request_id?: string;
  user_id?: string;
  duration_ms: number;
  error?: string;
}

export interface AgentDeps {
  authenticate(jwt: string): Promise<{ userId: string } | null>;
  userStore(jwt: string): UserStore;
  system: SystemStore;
  market: MarketStore;
  now(): Date;
  sha256Hex(text: string): Promise<string>;
  allowedOrigins: string[];
  log(entry: LogEntry): void;
}
