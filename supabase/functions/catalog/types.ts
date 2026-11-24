// Contratos de `GET /catalog` (T18b) e dos acessos ao banco injetados no handler.
import type { LogEntry, UserStore } from "../agent/types.ts";
import type { SnapshotFreshness } from "./freshness.ts";

export type { LogEntry, UserStore };

export interface CatalogAssetRow {
  // assets.id (uuid): o navegador usa para gravar a carteira (portfolio_items.asset_id).
  id: string;
  symbol: string;
  asset_class: string;
  name: string | null;
}

export interface CatalogSnapshotRow {
  id: string;
  collected_at: string;
  universe_version: string | null;
  assets_total: number;
  assets_updated: number;
  published_at: string | null;
  // jsonb do manifesto; validado e saneado pelo handler.
  failures: unknown;
}

// Estados de validação do contrato da T06 (inclui `not_applicable`).
export type StatusCounts = Record<
  | "verified"
  | "divergent"
  | "single_source"
  | "incomparable"
  | "missing"
  | "not_applicable"
  | "invalid",
  number
>;

// Leitura de mercado (cliente administrativo; o navegador não tem acesso).
export interface CatalogStore {
  // Ativos do universo (ações), ordenados por símbolo.
  listAssets(): Promise<CatalogAssetRow[]>;
  // `base_url` da fonte de referência (data_sources); nulo se não cadastrada/habilitada.
  referenceBaseUrl(): Promise<string | null>;
  activeSnapshot(universe: string): Promise<CatalogSnapshotRow | null>;
  statusCounts(snapshotId: string): Promise<StatusCounts>;
}

export interface CatalogDeps {
  authenticate(jwt: string): Promise<{ userId: string } | null>;
  userStore(jwt: string): UserStore;
  store: CatalogStore;
  now(): Date;
  allowedOrigins: string[];
  log(entry: LogEntry): void;
}

export interface CatalogFailure {
  asset_id: string;
  source_id: string;
  reason: string;
}

export interface CatalogResponse {
  universe_version: string | null;
  assets: {
    id: string;
    asset_id: string;
    name: string | null;
    reference_url: string | null;
  }[];
  metrics: { metric: string; label: string; unit: string }[];
  snapshot: {
    snapshot_id: string;
    collected_at: string;
    freshness: SnapshotFreshness;
    assets_total: number;
    assets_updated: number;
    failures: CatalogFailure[];
    status_counts: StatusCounts;
  } | null;
}
