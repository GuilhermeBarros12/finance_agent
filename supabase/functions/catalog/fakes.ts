// Dublês em memória para os testes de GET /catalog (rodam na CI sem Supabase).
// Dados sintéticos, escritos à mão, espelhando supabase/seed.sql (DEMO3, TEST4).
import type {
  CatalogAssetRow,
  CatalogDeps,
  CatalogSnapshotRow,
  CatalogStore,
  LogEntry,
  StatusCounts,
} from "./types.ts";

export const USER_ANA = "11111111-1111-4111-8111-111111111111";
export const USER_CAIO = "33333333-3333-4333-8333-333333333333";
export const USER_DESABILITADO = "44444444-4444-4444-8444-444444444444";
export const JWT_ANA = "jwt-ana";
export const JWT_CAIO = "jwt-caio"; // existe no Auth, fora de allowed_users
export const JWT_DESABILITADO = "jwt-desabilitado"; // allowed_users.enabled = false
export const SERVICE_KEY_FAKE = "chave-de-servico-sintetica";

// Mesma forma do seed: uma validação em cada um destes quatro estados.
export const SEED_STATUSES = [
  "verified",
  "divergent",
  "incomparable",
  "missing",
];

export function emptyCounts(): StatusCounts {
  return {
    verified: 0,
    divergent: 0,
    single_source: 0,
    incomparable: 0,
    missing: 0,
    not_applicable: 0,
    invalid: 0,
  };
}

export function countStatuses(statuses: string[]): StatusCounts {
  const counts = emptyCounts();
  for (const s of statuses) counts[s as keyof StatusCounts]++;
  return counts;
}

export const SNAPSHOT_SEED: CatalogSnapshotRow = {
  id: "d0000000-0000-4000-8000-000000000001",
  collected_at: "2026-09-18T20:05:00+00:00",
  universe_version: "seed-1",
  assets_total: 2,
  assets_updated: 2,
  published_at: "2026-09-18T20:06:00+00:00",
  failures: [],
};

export const ASSETS: CatalogAssetRow[] = [
  {
    id: "a0000000-0000-4000-8000-000000000002",
    symbol: "TEST4",
    asset_class: "stock",
    name: "Teste S.A. (fictícia)",
  },
  {
    id: "a0000000-0000-4000-8000-000000000001",
    symbol: "DEMO3",
    asset_class: "stock",
    name: "Demo S.A. (fictícia)",
  },
];

export class FakeCatalogStore implements CatalogStore {
  calls = 0;
  constructor(
    public assets: CatalogAssetRow[] = ASSETS,
    public baseUrl: string | null = "https://statusinvest.com.br",
    public snapshot: CatalogSnapshotRow | null = SNAPSHOT_SEED,
    public statuses: string[] = SEED_STATUSES,
  ) {}
  listAssets() {
    this.calls++;
    return Promise.resolve(this.assets);
  }
  referenceBaseUrl() {
    return Promise.resolve(this.baseUrl);
  }
  activeSnapshot() {
    return Promise.resolve(this.snapshot);
  }
  statusCounts() {
    return Promise.resolve(countStatuses(this.statuses));
  }
}

export interface Harness {
  deps: CatalogDeps;
  store: FakeCatalogStore;
  logs: LogEntry[];
  setNow(d: Date): void;
}

export function makeDeps(
  opts: { store?: FakeCatalogStore; now?: Date; origins?: string[] } = {},
): Harness {
  const store = opts.store ?? new FakeCatalogStore();
  const logs: LogEntry[] = [];
  let now = opts.now ?? new Date("2026-09-18T21:00:00Z");
  const users: Record<string, { id: string; enabled: boolean | null }> = {
    [JWT_ANA]: { id: USER_ANA, enabled: true },
    [JWT_CAIO]: { id: USER_CAIO, enabled: null },
    [JWT_DESABILITADO]: { id: USER_DESABILITADO, enabled: false },
  };
  const deps: CatalogDeps = {
    // Só JWT de usuário autentica; chave de serviço/anon não está na tabela: 401.
    authenticate: (jwt) => {
      const u = users[jwt];
      return Promise.resolve(u ? { userId: u.id } : null);
    },
    userStore: (jwt) => ({
      isAllowedUser: (userId) =>
        Promise.resolve(
          users[jwt]?.id === userId && users[jwt].enabled === true,
        ),
      ownsConversation: () => Promise.resolve(false),
    }),
    store,
    now: () => now,
    allowedOrigins: opts.origins ?? ["https://app.example.test"],
    log: (e) => logs.push(e),
  };
  return { deps, store, logs, setNow: (d) => (now = d) };
}
