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
const DECIMAL_PATTERN = /^-?[0-9]+(\.[0-9]+)?$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATETIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const MAX_SAFE_INT = 9007199254740991;
// Espaço, controle (0x00-0x20, 0x7f-0x9f) e barra invertida; igual a contracts.py.
function hasForbiddenUrlChar(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f) || ch === "\\") {
      return true;
    }
  }
  return false;
}
const URL_AUTHORITY_PATTERN = /^[A-Za-z0-9._-]+(:[0-9]{0,5})?$/;
// Octeto decimal estrito (0 a 255, sem zero à esquerda). Mesma regra de contracts.py.
const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
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
  if (y < 1) return false; // Python não tem ano 0
  // setUTCFullYear evita o mapeamento de anos 0 a 99 para 1900 a 1999 do Date.UTC.
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
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
// Substituto UTF-16 isolado não é texto válido: o Pydantic rejeita, então o Zod também.
const wellFormed = (s: string) => s.isWellFormed();
const nonEmpty = z.string().min(1).refine(wellFormed, {
  message: "texto com substituto UTF-16 isolado",
});

export function isSafeSourceUrl(value: string): boolean {
  if (!value.isWellFormed()) return false;
  if (hasForbiddenUrlChar(value)) return false;
  const match = value.match(/^https?:\/\/([^/?#]*)/i);
  if (!match || !match[1]) return false;
  const authority = match[1];
  if (authority.includes("@")) return false;
  if (!URL_AUTHORITY_PATTERN.test(authority)) return false;
  const host = authority.split(":")[0];
  // Um ponto final único não conta como rótulo (como em `new URL`).
  const bareHost = host.endsWith(".") ? host.slice(0, -1) : host;
  const labels = bareHost.split(".");
  if (labels.some((l) => l.toLowerCase().startsWith("xn--"))) return false;
  if (
    /^[0-9]/.test(labels[labels.length - 1]) && !IPV4_PATTERN.test(bareHost)
  ) {
    return false;
  }
  const port = authority.split(":")[1];
  if (port && Number(port) > 65535) return false;
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
    methodology_id: nonEmpty.default("unknown"),
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

const isDecimal = (v: unknown): v is string =>
  typeof v === "string" && DECIMAL_PATTERN.test(v);

// Compara decimais canônicos sem passar por float. Retorna -1, 0 ou 1.
// Entrada fora de DECIMAL_PATTERN lança RangeError; os refines checam antes.
export function compareDecimal(a: string, b: string): number {
  if (!isDecimal(a) || !isDecimal(b)) {
    throw new RangeError("decimal fora do padrão canônico");
  }
  const parse = (t: string) => {
    const neg = t.startsWith("-");
    const [i, f = ""] = (neg ? t.slice(1) : t).split(".");
    return { neg, i, f };
  };
  const pa = parse(a);
  const pb = parse(b);
  const scale = Math.max(pa.f.length, pb.f.length);
  const toInt = (p: { neg: boolean; i: string; f: string }) => {
    const n = BigInt(p.i + p.f.padEnd(scale, "0"));
    return p.neg ? -n : n;
  };
  const x = toInt(pa);
  const y = toInt(pb);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const comparisonSchema = z
  .strictObject({
    delta_abs: decimalStr,
    limit: decimalStr,
    atol: decimalStr,
    rtol: decimalStr,
    tolerance_version: nonEmpty,
  })
  .superRefine((c, ctx) => {
    for (const name of ["delta_abs", "limit", "atol", "rtol"] as const) {
      if (isDecimal(c[name]) && compareDecimal(c[name], "0") < 0) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: `${name} não pode ser negativo`,
        });
      }
    }
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
    reason: z.string().refine(wellFormed, {
      message: "texto com substituto UTF-16 isolado",
    }).nullish(),
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
    const count = v.observation_ids.length;
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (
      v.status === "missing" || v.status === "invalid" ||
      v.status === "not_applicable"
    ) {
      if (v.selected_observation_id != null) {
        issue(
          "selected_observation_id",
          `${v.status} não seleciona observação`,
        );
      }
      if (v.comparison != null) {
        issue("comparison", `${v.status} não tem comparison`);
      }
    }
    if (v.status === "single_source") {
      if (count !== 1) {
        issue(
          "observation_ids",
          "single_source exige exatamente uma observação",
        );
      }
      if (v.comparison != null) {
        issue("comparison", "single_source não tem comparison");
      }
    }
    if ((v.status === "verified" || v.status === "divergent") && count < 2) {
      issue("observation_ids", `${v.status} exige duas ou mais observações`);
    }
    if (
      v.comparison != null &&
      isDecimal(v.comparison.delta_abs) &&
      isDecimal(v.comparison.limit)
    ) {
      const cmp = compareDecimal(v.comparison.delta_abs, v.comparison.limit);
      if (v.status === "verified" && cmp > 0) {
        issue("comparison", "verified exige delta_abs <= limit");
      }
      if (v.status === "divergent" && cmp <= 0) {
        issue("comparison", "divergent exige delta_abs > limit");
      }
    }
  });

// Inteiro JSON seguro (0 a 2^53 - 1); `10.0` já chega aqui como 10.
const count = z.number().int().min(0).max(MAX_SAFE_INT);

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
    assets_total: count,
    assets_updated: count,
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
