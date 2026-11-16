// Dublês em memória para os testes unitários (rodam na CI sem Supabase).
// Reproduzem as regras do banco que o handler usa: FK composta de request_runs,
// unicidade (user_id, request_id), unicidade de sequence_no e a atualização de
// updated_at. Dados sintéticos escritos à mão (DEMO3, TEST4, ONEA3).
import { sha256Hex } from "./request.ts";
import type {
  AgentDeps,
  AssetRow,
  LogEntry,
  NewRun,
  ObservationRow,
  RunRow,
  SnapshotRow,
  TurnInput,
  ValidationRow,
} from "./types.ts";

export const USER_ANA = "11111111-1111-4111-8111-111111111111";
export const USER_BIA = "22222222-2222-4222-8222-222222222222";
export const USER_CAIO = "33333333-3333-4333-8333-333333333333";
export const JWT_ANA = "jwt-ana";
export const JWT_BIA = "jwt-bia";
export const JWT_CAIO = "jwt-caio"; // existe no Auth, mas não está em allowed_users
export const CONV_ANA = "c1000000-0000-4000-8000-000000000001";
export const CONV_BIA = "c2000000-0000-4000-8000-000000000002";
export const REQ_1 = "6e51ed30-9fd4-48fd-9a19-060f8197cda1";

export const A_DEMO = "a0000000-0000-4000-8000-000000000001";
export const A_TEST = "a0000000-0000-4000-8000-000000000002";
export const A_ONEA = "a0000000-0000-4000-8000-000000000003";
export const SNAP = "d0000000-0000-4000-8000-000000000001";

const RUN = "c0000000-0000-4000-8000-000000000001";
const SRC_FUND = "fundamentus";
const SRC_STATUS = "statusinvest";

export interface StoredRun extends RunRow {
  user_id: string;
  request_id: string;
  conversation_id: string;
  error: string | null;
}

export interface StoredMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: "user" | "assistant";
  sequence_no: number;
  content: string;
  payload: unknown;
}

function obs(
  n: number,
  asset: string,
  metric: string,
  source: string,
  raw: string,
  value: string,
  unit: string,
  currency: string | null,
  referenceDate = "2026-09-18",
): ObservationRow {
  return {
    id: `e0000000-0000-4000-8000-00000000000${n}`,
    snapshot_id: SNAP,
    asset_id: asset,
    source_code: source,
    metric,
    raw_value: raw,
    value_decimal: value,
    unit,
    currency,
    period_start: null,
    period_end: null,
    reference_at: null,
    reference_date: referenceDate,
    collected_at: "2026-09-18T20:01:00+00:00",
    source_url: `https://${source}.example.test/${n}`,
    upstream_source: null,
    methodology_id: "provisional",
    run_id: RUN,
    parser_version: "teste-1",
    raw_content_hash: String(n).repeat(64),
  };
}

function validation(
  n: number,
  asset: string,
  metric: string,
  status: string,
  observationIds: string[],
  selected: string | null,
  comparison: [string, string, string, string] | null,
  freshness = "fresh",
): ValidationRow {
  return {
    id: `f0000000-0000-4000-8000-00000000000${n}`,
    snapshot_id: SNAP,
    asset_id: asset,
    metric,
    status,
    freshness,
    selected_observation_id: selected,
    observation_ids: observationIds,
    delta_abs: comparison?.[0] ?? null,
    limit_value: comparison?.[1] ?? null,
    atol: comparison?.[2] ?? null,
    rtol: comparison?.[3] ?? null,
    tolerance_version: comparison ? "teste-1" : null,
    reason: status === "missing" ? "Nenhuma fonte trouxe o campo" : null,
  };
}

export function defaultMarket() {
  const assets: AssetRow[] = [
    { id: A_DEMO, symbol: "DEMO3", asset_class: "stock" },
    { id: A_TEST, symbol: "TEST4", asset_class: "stock" },
    { id: A_ONEA, symbol: "ONEA3", asset_class: "stock" },
  ];
  const e = (n: number) => `e0000000-0000-4000-8000-00000000000${n}`;
  const observations: ObservationRow[] = [
    obs(1, A_DEMO, "price_to_book", SRC_FUND, "1,50", "1.50", "ratio", null),
    obs(2, A_DEMO, "price_to_book", SRC_STATUS, "1,51", "1.51", "ratio", null),
    obs(
      3,
      A_DEMO,
      "dividend_yield",
      SRC_FUND,
      "8,50%",
      "8.50",
      "percent",
      null,
    ),
    obs(
      4,
      A_DEMO,
      "dividend_yield",
      SRC_STATUS,
      "9,10%",
      "9.10",
      "percent",
      null,
    ),
    obs(
      5,
      A_TEST,
      "price_to_earnings",
      SRC_FUND,
      "12,0",
      "12.0",
      "ratio",
      null,
    ),
    obs(
      6,
      A_TEST,
      "price_to_earnings",
      SRC_STATUS,
      "9,8",
      "9.8",
      "ratio",
      null,
      "2026-06-30",
    ),
    obs(7, A_ONEA, "roe", SRC_FUND, "15,25%", "15.25", "percent", null),
  ];
  const validations: ValidationRow[] = [
    validation(1, A_DEMO, "price_to_book", "verified", [e(1), e(2)], e(1), [
      "0.01",
      "0.0302",
      "0.02",
      "0.02",
    ]),
    validation(2, A_DEMO, "dividend_yield", "divergent", [e(3), e(4)], null, [
      "0.60",
      "0.20",
      "0.20",
      "0",
    ]),
    validation(
      3,
      A_TEST,
      "price_to_earnings",
      "incomparable",
      [e(5), e(6)],
      null,
      null,
    ),
    validation(
      4,
      A_TEST,
      "roe",
      "missing",
      [],
      null,
      null,
      "unknown_reference_date",
    ),
    validation(5, A_ONEA, "roe", "single_source", [e(7)], e(7), null),
  ];
  const snapshot: SnapshotRow = {
    id: SNAP,
    collected_at: "2026-09-18T20:05:00+00:00",
    assets_total: 3,
    assets_updated: 3,
    published_at: "2026-09-18T20:06:00+00:00",
  };
  return { assets, observations, validations, snapshot };
}

export class FakeWorld {
  clock = new Date("2026-09-19T12:00:00.000Z");
  // jwt -> user id. Token ausente da tabela = inválido.
  sessions = new Map<string, string>([
    [JWT_ANA, USER_ANA],
    [JWT_BIA, USER_BIA],
    [JWT_CAIO, USER_CAIO],
  ]);
  allowed = new Map<string, boolean>([[USER_ANA, true], [USER_BIA, true]]);
  conversations = new Map<string, string>([
    [CONV_ANA, USER_ANA],
    [CONV_BIA, USER_BIA],
  ]);
  runs: StoredRun[] = [];
  messages: StoredMessage[] = [];
  logs: LogEntry[] = [];
  origins: string[] = [];
  failPersist = false;
  marketCalls = 0;
  market = defaultMarket();
  snapshot: SnapshotRow | null = this.market.snapshot;

  advance(ms: number) {
    this.clock = new Date(this.clock.getTime() + ms);
  }

  deps(): AgentDeps {
    // deno-lint-ignore no-this-alias
    const w = this;
    return {
      authenticate: (jwt) => {
        const id = w.sessions.get(jwt);
        return Promise.resolve(id ? { userId: id } : null);
      },
      userStore: () => ({
        isAllowedUser: (userId) =>
          Promise.resolve(w.allowed.get(userId) === true),
        // RLS: só enxerga conversa do próprio dono.
        ownsConversation: (userId, conversationId) =>
          Promise.resolve(w.conversations.get(conversationId) === userId),
      }),
      system: {
        insert(run: NewRun) {
          if (w.conversations.get(run.conversation_id) !== run.user_id) {
            return Promise.resolve({
              ok: false as const,
              reason: "conversation_missing" as const,
            });
          }
          if (
            w.runs.some((r) =>
              r.user_id === run.user_id && r.request_id === run.request_id
            )
          ) {
            return Promise.resolve({
              ok: false as const,
              reason: "duplicate" as const,
            });
          }
          const stored: StoredRun = {
            id: `run-${w.runs.length + 1}`,
            ...run,
            status: "processing",
            response: null,
            error: null,
            updated_at: w.clock.toISOString(),
          };
          w.runs.push(stored);
          return Promise.resolve({ ok: true as const, run: stored });
        },
        find(userId, requestId) {
          const r = w.runs.find((x) =>
            x.user_id === userId && x.request_id === requestId
          );
          return Promise.resolve(r ?? null);
        },
        takeOver(id, from, staleBefore) {
          const r = w.runs.find((x) => x.id === id);
          if (!r || r.status !== from) return Promise.resolve(false);
          if (from === "processing" && !(r.updated_at < staleBefore)) {
            return Promise.resolve(false);
          }
          r.status = "processing";
          r.error = null;
          r.updated_at = w.clock.toISOString();
          return Promise.resolve(true);
        },
        complete(id, response) {
          const r = w.runs.find((x) => x.id === id)!;
          r.status = "succeeded";
          r.response = structuredClone(response);
          r.updated_at = w.clock.toISOString();
          return Promise.resolve();
        },
        fail(id, code) {
          const r = w.runs.find((x) => x.id === id)!;
          r.status = "failed";
          r.error = code;
          r.updated_at = w.clock.toISOString();
          return Promise.resolve();
        },
        persistTurn(turn: TurnInput) {
          if (w.failPersist) return Promise.reject(new Error("falha simulada"));
          const ids = [turn.user_message_id, turn.assistant_message_id];
          if (w.messages.some((m) => ids.includes(m.id))) {
            return Promise.resolve();
          }
          const last = Math.max(
            0,
            ...w.messages
              .filter((m) => m.conversation_id === turn.conversation_id)
              .map((m) => m.sequence_no),
          );
          const base = {
            conversation_id: turn.conversation_id,
            user_id: turn.user_id,
          };
          w.messages.push(
            {
              ...base,
              id: turn.user_message_id,
              role: "user",
              sequence_no: last + 1,
              content: turn.user_content,
              payload: null,
            },
            {
              ...base,
              id: turn.assistant_message_id,
              role: "assistant",
              sequence_no: last + 2,
              content: turn.assistant_content,
              payload: structuredClone(turn.payload),
            },
          );
          return Promise.resolve();
        },
      },
      market: {
        findAssets: (symbols) => {
          w.marketCalls++;
          return Promise.resolve(
            w.market.assets.filter((a) => symbols.includes(a.symbol)),
          );
        },
        activeSnapshot: () => Promise.resolve(w.snapshot),
        loadValidations: (_s, assetIds, metrics) =>
          Promise.resolve(
            w.market.validations.filter((v) =>
              assetIds.includes(v.asset_id) && metrics.includes(v.metric)
            ),
          ),
        loadObservations: (_s, assetIds, metrics) =>
          Promise.resolve(
            w.market.observations.filter((o) =>
              assetIds.includes(o.asset_id) && metrics.includes(o.metric)
            ),
          ),
      },
      now: () => w.clock,
      sha256Hex,
      allowedOrigins: w.origins,
      log: (entry) => w.logs.push(entry),
    };
  }
}

export function agentRequest(
  body: unknown,
  opts: { jwt?: string | null; method?: string; headers?: HeadersInit } = {},
): Request {
  const headers = new Headers(opts.headers);
  headers.set("content-type", "application/json");
  const jwt = opts.jwt === undefined ? JWT_ANA : opts.jwt;
  if (jwt) headers.set("authorization", `Bearer ${jwt}`);
  return new Request("http://127.0.0.1/functions/v1/agent", {
    method: opts.method ?? "POST",
    headers,
    body: (opts.method ?? "POST") === "POST"
      ? typeof body === "string" ? body : JSON.stringify(body)
      : undefined,
  });
}

export function validBody(overrides: Record<string, unknown> = {}) {
  return {
    request_id: REQ_1,
    conversation_id: CONV_ANA,
    selection: {
      asset_ids: ["DEMO3"],
      metrics: ["price_to_book", "dividend_yield"],
    },
    ...overrides,
  };
}
