import { METRIC_UNIT, isMetric } from './contracts'
import type { ValueUnit } from './format'

// Unidade de exibição: a da observação (contrato da T06); se vier outra coisa, a da métrica.
export function unitFor(observationUnit: string, metric: string): ValueUnit {
  if (observationUnit === 'BRL' || observationUnit === 'ratio' || observationUnit === 'percent') return observationUnit
  return isMetric(metric) ? METRIC_UNIT[metric] : 'ratio'
}

// Diferença e limite de uma comparação de percentuais estão em pontos percentuais.
export function deltaUnit(unit: ValueUnit): ValueUnit {
  return unit === 'percent' ? 'percent_points' : unit
}
