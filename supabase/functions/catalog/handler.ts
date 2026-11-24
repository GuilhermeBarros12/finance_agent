// GET /catalog (T18b): o que o front precisa para o seletor, a carteira e o painel de
// estado dos dados. Ordem: método -> autenticar -> autorizar -> ler -> montar.
// Sem LLM, sem carteira, sem escrita. O cliente administrativo só é usado depois de
// autenticar e autorizar (as tabelas de mercado não são legíveis pelo navegador).
import { AppError, errorBody, errors } from "../_shared/errors.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { bearer } from "../_shared/auth.ts";
import { METRIC_UNIT, METRICS } from "../_shared/schemas.ts";
import { buildReferenceUrl } from "./reference.ts";
import { sanitizeId, sanitizeReason } from "./sanitize.ts";
import { computeFreshness } from "./freshness.ts";
import type { CatalogDeps, CatalogFailure, CatalogResponse } from "./types.ts";

const UNIVERSE = "stocks";
const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const ALLOW = "GET, OPTIONS";

// Rótulos em português (README 7.2/9); a unidade vem do contrato (METRIC_UNIT).
const METRIC_LABELS: Record<(typeof METRICS)[number], string> = {
  quote_price: "Cotação",
  price_to_book: "P/VP",
  price_to_earnings: "P/L",
  dividend_yield: "Dividend yield",
  roe: "ROE",
};

export const CATALOG_METRICS = METRICS.map((metric) => ({
  metric,
  label: METRIC_LABELS[metric],
  unit: METRIC_UNIT[metric],
}));

function json(status: number, body: unknown, extra = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

// Falha dado inconsistente do manifesto: erro explícito (500), nunca lista vazia.
class InconsistentDataError extends Error {}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Identificador malformado vindo do banco é dado inconsistente (500), nunca valor
// inventado nem omitido.
function validUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new InconsistentDataError("id de ativo malformado");
  }
  return value.toLowerCase();
}

export function summarizeFailures(raw: unknown): CatalogFailure[] {
  if (!Array.isArray(raw)) {
    throw new InconsistentDataError("manifesto sem lista de falhas");
  }
  return raw.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new InconsistentDataError("falha malformada");
    }
    const { asset_id, source_id, reason } = item as Record<string, unknown>;
    if (
      typeof asset_id !== "string" || typeof source_id !== "string" ||
      typeof reason !== "string"
    ) {
      throw new InconsistentDataError("falha malformada");
    }
    return {
      asset_id: sanitizeId(asset_id),
      source_id: sanitizeId(source_id),
      reason: sanitizeReason(reason),
    };
  });
}

export async function handleCatalogRequest(
  req: Request,
  deps: CatalogDeps,
): Promise<Response> {
  const started = deps.now().getTime();
  const cors = corsHeaders(req, deps.allowedOrigins, ALLOW);
  let userId: string | undefined;

  const finish = (res: Response, code?: string, error?: string): Response => {
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    // Log sem token, sem cabeçalhos.
    deps.log({
      event: "catalog_request",
      status: res.status,
      code,
      user_id: userId,
      duration_ms: deps.now().getTime() - started,
      error,
    });
    return res;
  };

  try {
    if (req.method === "OPTIONS") {
      return finish(new Response(null, { status: 204 }));
    }
    if (req.method !== "GET") throw errors.methodNotAllowed("GET");

    // 1. Autenticar: o user_id sai do JWT e de mais lugar nenhum.
    const jwt = bearer(req);
    if (!jwt) throw errors.unauthenticated();
    const user = await deps.authenticate(jwt);
    if (!user) throw errors.unauthenticated();
    userId = user.userId;

    // 2. Autorizar (allowed_users com enabled, via RLS com o JWT do usuário).
    if (!(await deps.userStore(jwt).isAllowedUser(userId))) {
      throw errors.accessDenied();
    }

    // 3. Ler o catálogo e o snapshot ativo.
    const [assetRows, baseUrl, snapshotRow] = await Promise.all([
      deps.store.listAssets(),
      deps.store.referenceBaseUrl(),
      deps.store.activeSnapshot(UNIVERSE),
    ]);

    const assets = [...assetRows]
      .sort((a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)
      .map((a) => ({
        id: validUuid(a.id),
        asset_id: a.symbol,
        name: a.name,
        reference_url: buildReferenceUrl(baseUrl, a.asset_class, a.symbol),
      }));

    let snapshot: CatalogResponse["snapshot"] = null;
    if (snapshotRow && snapshotRow.published_at) {
      const collected = new Date(snapshotRow.collected_at);
      if (Number.isNaN(collected.getTime())) {
        throw new InconsistentDataError("collected_at inválido");
      }
      snapshot = {
        snapshot_id: snapshotRow.id,
        collected_at: snapshotRow.collected_at,
        freshness: computeFreshness(collected, deps.now()),
        assets_total: snapshotRow.assets_total,
        assets_updated: snapshotRow.assets_updated,
        failures: summarizeFailures(snapshotRow.failures),
        status_counts: await deps.store.statusCounts(snapshotRow.id),
      };
    }

    const body: CatalogResponse = {
      // Do snapshot ativo; sem snapshot (ou sem versão gravada) é nulo, nunca inventado.
      universe_version: snapshot ? snapshotRow?.universe_version ?? null : null,
      assets,
      metrics: CATALOG_METRICS,
      snapshot,
    };
    return finish(json(200, body));
  } catch (err) {
    const appError = err instanceof AppError ? err : errors.internal();
    return finish(
      json(
        appError.status,
        errorBody(appError),
        appError.status === 405 ? { Allow: ALLOW } : {},
      ),
      appError.code,
      appError.status >= 500 ? describe(err) : undefined,
    );
  }
}

// Descrição curta e segura para o log: tipo e mensagem truncada, sem corpo nem token.
function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 200);
  return "erro desconhecido";
}
