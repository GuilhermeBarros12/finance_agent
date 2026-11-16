// Pacote de evidências e resposta estruturada (D21, `messages.payload` versão 1).
// Módulo puro: recebe linhas já lidas e devolve o payload. Regras que ele aplica:
//  - cada campo (ativo, métrica) usa SÓ a própria validação; nada é herdado de outro;
//  - `divergent` mantém selected_observation_id nulo e leva as DUAS observações;
//  - campo sem validação no snapshot vira aviso, nunca zero nem linha vazia;
//  - valores são strings decimais do banco; nada passa por Number;
//  - a evidência é uma CÓPIA (structuredClone): apagar o snapshot não quebra a mensagem.
import {
  type FieldValidation,
  fieldValidationSchema,
  type Observation,
  observationSchema,
} from "../_shared/schemas.ts";
import type {
  AssetRow,
  ObservationRow,
  SnapshotRow,
  ValidationRow,
} from "./types.ts";

export type EvidenceValidation = FieldValidation & { validation_id: string };

export interface Warning {
  code: string;
  message: string;
  asset_id?: string;
  metric?: string;
}

export interface Section {
  kind: "metric_table" | "limitation";
  metric?: string;
  validation_ids: string[];
}

export interface MessagePayload {
  content_version: 1;
  mode: "deterministic";
  snapshot_id: string;
  snapshot_collected_at: string;
  manifest: { assets_total: number; assets_updated: number };
  sections: Section[];
  evidence: {
    validations: EvidenceValidation[];
    observations: Observation[];
  };
  warnings: Warning[];
}

export interface Citation {
  observation_id: string;
  asset_id: string;
  metric: string;
  source_id: string;
  source_url: string;
  collected_at: string;
  reference_at: string | null;
}

export interface Coverage {
  status: "complete" | "partial";
  missing_fields: { asset_id: string; metric: string; reason: string }[];
}

export interface Assembled {
  payload: MessagePayload;
  citations: Citation[];
  coverage: Coverage;
}

// Dado do banco que não cumpre o contrato da T06. Não é erro do usuário (vira 500).
export class InconsistentDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InconsistentDataError";
  }
}

// Estados com valor apresentável: a tabela mostra a(s) observação(ões).
const TABLE_STATUSES = new Set(["verified", "single_source", "divergent"]);

export const METRIC_LABELS: Record<string, string> = {
  quote_price: "Cotação",
  price_to_book: "P/VP",
  price_to_earnings: "P/L",
  dividend_yield: "Dividend Yield",
  roe: "ROE",
};

export interface AssembleInput {
  snapshot: SnapshotRow;
  assets: AssetRow[]; // na ordem pedida
  metrics: string[]; // na ordem pedida
  validations: ValidationRow[];
  observations: ObservationRow[];
}

export function assembleEvidence(input: AssembleInput): Assembled {
  const { snapshot, assets, metrics } = input;
  const obsById = new Map(input.observations.map((o) => [o.id, o]));
  const valByKey = new Map(
    input.validations.map((v) => [`${v.asset_id}|${v.metric}`, v]),
  );

  const validations: EvidenceValidation[] = [];
  const observations: Observation[] = [];
  const seenObs = new Set<string>();
  const warnings: Warning[] = [];
  const missing: Coverage["missing_fields"] = [];
  const tableByMetric = new Map<string, string[]>();
  const limitation: string[] = [];

  for (const metric of metrics) {
    for (const asset of assets) {
      const row = valByKey.get(`${asset.id}|${metric}`);
      if (!row) {
        // Sem validação no snapshot: informa a ausência. Não cria valor nem linha.
        warnings.push({
          code: "FIELD_NOT_IN_SNAPSHOT",
          message:
            `${asset.symbol}: o indicador ${metric} não consta no lote publicado.`,
          asset_id: asset.symbol,
          metric,
        });
        missing.push({
          asset_id: asset.symbol,
          metric,
          reason: "not_in_snapshot",
        });
        continue;
      }
      if (row.snapshot_id !== snapshot.id) {
        throw new InconsistentDataError("validação de outro snapshot");
      }

      const validation = toValidation(row, asset.symbol);
      validations.push(validation);

      for (const obsId of row.observation_ids) {
        const obs = obsById.get(obsId);
        // A observação precisa ser do mesmo ativo e da mesma métrica: um campo não
        // usa evidência de outro.
        if (
          !obs || obs.asset_id !== row.asset_id || obs.metric !== row.metric ||
          obs.snapshot_id !== snapshot.id
        ) {
          throw new InconsistentDataError(
            "observação ausente ou de outro campo na validação",
          );
        }
        if (!seenObs.has(obsId)) {
          seenObs.add(obsId);
          observations.push(toObservation(obs, asset.symbol));
        }
      }

      if (TABLE_STATUSES.has(row.status)) {
        const ids = tableByMetric.get(metric) ?? [];
        ids.push(row.id);
        tableByMetric.set(metric, ids);
        if (row.freshness !== "fresh") {
          warnings.push({
            code: row.freshness === "unknown_reference_date"
              ? "UNKNOWN_REFERENCE_DATE"
              : "STALE_DATA",
            message: row.freshness === "unknown_reference_date"
              ? `${asset.symbol}: a data-base de ${metric} não é conhecida.`
              : `${asset.symbol}: o dado de ${metric} está desatualizado.`,
            asset_id: asset.symbol,
            metric,
          });
        }
      } else {
        limitation.push(row.id);
        missing.push({
          asset_id: asset.symbol,
          metric,
          reason: row.status,
        });
      }
    }
  }

  const sections: Section[] = [];
  for (const metric of metrics) {
    const ids = tableByMetric.get(metric);
    if (ids) {
      sections.push({ kind: "metric_table", metric, validation_ids: ids });
    }
  }
  if (limitation.length > 0) {
    sections.push({ kind: "limitation", validation_ids: limitation });
  }

  if (snapshot.assets_updated < snapshot.assets_total) {
    warnings.push({
      code: "PARTIAL_COVERAGE",
      message:
        `O lote atualizou ${snapshot.assets_updated} de ${snapshot.assets_total} ativos.`,
    });
  }

  const payload: MessagePayload = {
    content_version: 1,
    mode: "deterministic",
    snapshot_id: snapshot.id,
    snapshot_collected_at: snapshot.collected_at,
    manifest: {
      assets_total: snapshot.assets_total,
      assets_updated: snapshot.assets_updated,
    },
    sections,
    // Cópia: não compartilha referência com nada que o chamador ainda possua.
    evidence: structuredClone({ validations, observations }),
    warnings,
  };

  const citations: Citation[] = payload.evidence.observations.map((o) => ({
    observation_id: o.observation_id,
    asset_id: o.asset_id,
    metric: o.metric,
    source_id: o.source_id,
    source_url: o.source_url,
    collected_at: o.collected_at,
    reference_at: o.reference_at ?? null,
  }));

  return {
    payload,
    citations,
    coverage: {
      status: missing.length === 0 ? "complete" : "partial",
      missing_fields: missing,
    },
  };
}

function toValidation(row: ValidationRow, symbol: string): EvidenceValidation {
  const hasComparison = row.status === "verified" || row.status === "divergent";
  const candidate = {
    asset_id: symbol,
    metric: row.metric,
    status: row.status,
    freshness: row.freshness,
    selected_observation_id: row.selected_observation_id,
    observation_ids: row.observation_ids,
    comparison: hasComparison
      ? {
        delta_abs: row.delta_abs,
        limit: row.limit_value,
        atol: row.atol,
        rtol: row.rtol,
        tolerance_version: row.tolerance_version,
      }
      : null,
    reason: row.reason,
  };
  // O contrato da T06 é a barreira: divergent com seleção, verified sem comparação etc.
  // não passam. Não corrigimos o dado; recusamos.
  const parsed = fieldValidationSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new InconsistentDataError("validação fora do contrato");
  }
  return { validation_id: row.id, ...parsed.data };
}

function toObservation(row: ObservationRow, symbol: string): Observation {
  const candidate = {
    observation_id: row.id,
    asset_id: symbol,
    asset_class: "stock",
    metric: row.metric,
    raw_value: row.raw_value,
    value_decimal: row.value_decimal,
    unit: row.unit,
    currency: row.currency,
    period_start: row.period_start,
    period_end: row.period_end,
    reference_at: row.reference_at ?? row.reference_date,
    collected_at: row.collected_at,
    source_id: row.source_code,
    source_url: row.source_url,
    upstream_source: row.upstream_source,
    methodology_id: row.methodology_id,
    run_id: row.run_id,
    parser_version: row.parser_version,
    raw_content_hash: row.raw_content_hash,
  };
  const parsed = observationSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new InconsistentDataError("observação fora do contrato");
  }
  return parsed.data;
}

// Texto determinístico da resposta. Sem número de mercado: os valores ficam
// só no payload estruturado, com fonte e data.
export function renderContent(
  symbols: string[],
  metrics: string[],
  collectedAt: string,
): string {
  const labels = metrics.map((m) => METRIC_LABELS[m] ?? m).join(", ");
  return `Resposta montada sem IA a partir do lote coletado em ${collectedAt}. ` +
    `Ativos: ${symbols.join(", ")}. Indicadores: ${labels}. ` +
    `Cada valor traz fonte, data e estado de validação.`;
}
