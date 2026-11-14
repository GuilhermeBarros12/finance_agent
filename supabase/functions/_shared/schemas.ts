// Validadores Zod dos contratos (T06). Espelham collector/src/collector/contracts.py,
// que é a fonte da verdade. Os tipos vêm de contracts.gen.ts, gerado do JSON Schema.
// O teste schemas_test.ts valida os mesmos exemplos de schemas/examples/ que o pytest.
import { z } from "zod";
import type {
  FieldValidation,
  Observation,
  SnapshotManifest,
} from "./contracts.gen.ts";

export type { FieldValidation, Observation, SnapshotManifest };

// Padrões idênticos aos de contracts.py.
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_PARAM_PATTERN =
  /token|key|secret|session|sid|auth|password|passwd|credential|signature/i;

export const METRICS = [
  "quote_price",
  "price_to_book",
  "price_to_earnings",
  "dividend_yield",
  "roe",
] as const;
export const UNITS = ["BRL", "ratio", "percent"] as const;
export const VALIDATION_STATUSES = [
  "verified",
  "divergent",
  "single_source",
  "incomparable",
  "missing",
  "not_applicable",
  "invalid",
] as const;
export const FRESHNESS_STATES = [
  "fresh",
  "stale",
  "expired",
  "unknown_reference_date",
] as const;

// Unidade exigida por métrica. Qualquer outra combinação é rejeitada.
export const METRIC_UNIT: Record<
  (typeof METRICS)[number],
  (typeof UNITS)[number]
> = {
  quote_price: "BRL",
  price_to_book: "ratio",
  price_to_earnings: "ratio",
  dividend_yield: "percent",
  roe: "percent",
};

function isRealDate(text: string): boolean {
  const [y, m, d] = text.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function isRealDateTime(text: string): boolean {
  if (!isRealDate(text.slice(0, 10))) return false;
  const hh = Number(text.slice(11, 13));
  const mm = Number(text.slice(14, 16));
  const ss = Number(text.slice(17, 19));
  if (hh > 23 || mm > 59 || ss > 59) return false;
  const offset = text.match(/[+-](\d{2}):(\d{2})$/);
  if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) {
    return false;
  }
  return true;
}

// Decimal sempre como string canônica ("8.50"); número, NaN e expoente são rejeitados.
export const decimalStr = z.string().regex(DECIMAL_PATTERN);
export const isoDate = z.string().regex(DATE_PATTERN).refine(isRealDate);
export const isoDateTime = z.string().regex(DATETIME_PATTERN).refine(
  isRealDateTime,
);
const referenceAt = z.union([isoDate, isoDateTime]);
const nonEmpty = z.string().min(1);

export function isSafeSourceUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/^https?:\/\/[^/?#]*@/i.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!url.hostname || url.username || url.password || url.hash) return false;
  for (const name of url.searchParams.keys()) {
    if (SECRET_PARAM_PATTERN.test(name)) return false;
  }
  return true;
}

const sourceUrl = z.string().refine(isSafeSourceUrl, {
  message:
    "source_url inválida: precisa ser http(s) sem credenciais, fragmento ou parâmetro secreto",
});

export const observationSchema = z
  .strictObject({
    observation_id: nonEmpty,
    asset_id: nonEmpty,
    asset_class: z.enum(["stock"]),
    metric: z.enum(METRICS),
    raw_value: nonEmpty,
    value_decimal: decimalStr,
    unit: z.enum(UNITS),
    currency: z.literal("BRL").nullish(),
    period_start: isoDate.nullish(),
    period_end: isoDate.nullish(),
    reference_at: referenceAt.nullish(),
    collected_at: isoDateTime,
    source_id: nonEmpty,
    source_url: sourceUrl,
    upstream_source: nonEmpty.nullish(),
    methodology_id: nonEmpty.optional(),
    run_id: nonEmpty,
    parser_version: nonEmpty,
    raw_content_hash: z.string().regex(SHA256_PATTERN),
  })
  .superRefine((obs, ctx) => {
    if (obs.unit !== METRIC_UNIT[obs.metric]) {
      ctx.addIssue({
        code: "custom",
        path: ["unit"],
        message: `unidade ${obs.unit} incompatível com ${obs.metric}`,
      });
    }
    if (obs.metric === "quote_price") {
      if (obs.currency !== "BRL") {
        ctx.addIssue({
          code: "custom",
          path: ["currency"],
          message: "quote_price exige currency BRL",
        });
      }
    } else if (obs.currency != null) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: `${obs.metric} não tem moeda`,
      });
    }
    if (
      obs.period_start && obs.period_end && obs.period_end < obs.period_start
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["period_end"],
        message: "period_end anterior a period_start",
      });
    }
  });

export const comparisonSchema = z.strictObject({
  delta_abs: decimalStr,
  limit: decimalStr,
  atol: decimalStr,
  rtol: decimalStr,
  tolerance_version: nonEmpty,
});

export const fieldValidationSchema = z
  .strictObject({
    asset_id: nonEmpty,
    metric: z.enum(METRICS),
    status: z.enum(VALIDATION_STATUSES),
    freshness: z.enum(FRESHNESS_STATES),
    selected_observation_id: nonEmpty.nullish(),
    observation_ids: z.array(nonEmpty),
    comparison: comparisonSchema.nullish(),
    reason: z.string().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "divergent" && v.selected_observation_id != null) {
      ctx.addIssue({
        code: "custom",
        path: ["selected_observation_id"],
        message: "divergent não seleciona observação",
      });
    }
    if (
      v.selected_observation_id != null &&
      !v.observation_ids.includes(v.selected_observation_id)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["selected_observation_id"],
        message: "selected_observation_id deve estar em observation_ids",
      });
    }
    if (
      (v.status === "verified" || v.status === "divergent") &&
      v.comparison == null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["comparison"],
        message: `${v.status} exige comparison`,
      });
    }
  });

export const sourceFailureSchema = z.strictObject({
  asset_id: nonEmpty,
  source_id: nonEmpty,
  reason: nonEmpty,
});

export const snapshotManifestSchema = z
  .strictObject({
    snapshot_id: nonEmpty,
    run_id: nonEmpty,
    collected_at: isoDateTime,
    universe_version: nonEmpty,
    assets_total: z.number().int().min(0),
    assets_updated: z.number().int().min(0),
    failures: z.array(sourceFailureSchema),
  })
  .superRefine((m, ctx) => {
    if (m.assets_updated > m.assets_total) {
      ctx.addIssue({
        code: "custom",
        path: ["assets_updated"],
        message: "assets_updated maior que assets_total",
      });
    }
  });
