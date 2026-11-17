// Textos fixos em português para códigos do servidor. Nenhum texto livre do servidor
// (mensagem de erro, aviso, resposta de LLM) é repetido na tela: só o código é lido,
// e só se estiver nesta tabela.
import { METRIC_LABEL, isMetric, type PayloadWarning } from './contracts'

export const NEEDS_SELECTION_REASON: Record<string, string> = {
  LLM_INVALID_OUTPUT: 'Não consegui interpretar a pergunta com segurança.',
  LLM_UNSUPPORTED: 'A pergunta pede algo que esta versão não cobre.',
  LLM_QUOTA_EXHAUSTED: 'O limite diário do modo por IA foi atingido.',
  LLM_QUOTA_UNAVAILABLE: 'Não foi possível conferir o limite diário do modo por IA.',
  LLM_PROVIDER_ERROR: 'O serviço de IA não respondeu como esperado.',
  LLM_TIMEOUT: 'O serviço de IA demorou demais para responder.',
  LLM_DISABLED: 'O modo por IA está desligado.',
  LLM_INPUT_TOO_LONG: 'A pergunta é longa demais para o modo por IA.',
  LLM_NO_UNIVERSE: 'Não há ações cadastradas para o modo por IA consultar.',
}
export const REASON_FALLBACK = 'A pergunta não pôde ser interpretada automaticamente.'

export function reasonText(code: string | null): string {
  return (code && NEEDS_SELECTION_REASON[code]) || REASON_FALLBACK
}

const TICKER = /^[A-Z0-9]{1,12}$/

// Aviso do payload: texto fixo por código; só o ticker (se tiver o formato) e o indicador
// (se for um dos cinco) entram como prefixo.
export function warningText(w: PayloadWarning): string {
  const who = w.asset_id && TICKER.test(w.asset_id) ? w.asset_id : null
  const what = w.metric && isMetric(w.metric) ? METRIC_LABEL[w.metric] : null
  const prefix = [who, what].filter(Boolean).join(', ')
  const lead = prefix ? `${prefix}: ` : ''
  switch (w.code) {
    case 'FIELD_NOT_IN_SNAPSHOT':
      return `${lead}este indicador não consta no lote publicado.`
    case 'STALE_DATA':
      return `${lead}o dado está desatualizado.`
    case 'UNKNOWN_REFERENCE_DATE':
      return `${lead}a data-base do dado não é conhecida.`
    case 'PARTIAL_COVERAGE':
      return 'O lote não atualizou todos os ativos.'
    default:
      return `${lead}aviso do sistema (código ${/^[A-Z_]{1,40}$/.test(w.code) ? w.code : 'desconhecido'}).`
  }
}

export interface AgentErrorView {
  title: string
  message: string
  retry: boolean // "Tentar de novo" com o mesmo request_id faz sentido
  selector?: boolean // oferecer o seletor manual
}

export function errorView(kind: 'network' | 'timeout' | 'bad_response' | 'processing' | number, code?: string): AgentErrorView {
  if (kind === 'network') {
    return { title: 'Sem conexão com o servidor', message: 'A pergunta não foi confirmada. Confira a conexão e tente de novo: o pedido não será duplicado.', retry: true }
  }
  if (kind === 'timeout') {
    return { title: 'O servidor demorou demais', message: 'A pergunta pode ou não ter sido processada. Tente de novo: o pedido não será duplicado.', retry: true }
  }
  if (kind === 'processing') {
    return { title: 'Ainda processando', message: 'O servidor ainda está processando esta pergunta. Tente de novo em instantes: o pedido não será duplicado.', retry: true }
  }
  if (kind === 'bad_response') {
    return { title: 'Resposta não reconhecida', message: 'O servidor respondeu em um formato inesperado. Nada foi exibido como dado.', retry: true }
  }
  if (kind === 409) {
    return { title: 'Pedido em conflito', message: 'Este pedido conflita com outro já enviado. Envie a pergunta de novo.', retry: false }
  }
  if (kind === 422) {
    return { title: 'Ação não reconhecida', message: 'Uma das ações não consta no catálogo. Escolha as ações no seletor manual.', retry: false, selector: true }
  }
  if (kind === 503 && code === 'DATA_UNAVAILABLE') {
    return { title: 'Dados ainda não coletados', message: 'Ainda não há um lote de dados publicado. Tente de novo depois da primeira coleta.', retry: true }
  }
  if (kind === 503) {
    return { title: 'Serviço indisponível', message: 'O serviço de autenticação não respondeu. Tente de novo em instantes.', retry: true }
  }
  if (kind === 404) {
    return { title: 'Conversa não encontrada', message: 'Esta conversa não existe ou não é sua.', retry: false }
  }
  if (kind === 400 || kind === 413) {
    return { title: 'Pedido inválido', message: 'A pergunta ou a seleção não foi aceita (tamanho ou formato). Revise e envie de novo.', retry: false }
  }
  if (kind === 401 || kind === 403) {
    return { title: 'Acesso negado', message: 'O servidor não autorizou este acesso.', retry: false }
  }
  return { title: 'Erro no servidor', message: 'Algo falhou do lado do servidor. Nada foi exibido como dado. Tente de novo.', retry: true }
}
