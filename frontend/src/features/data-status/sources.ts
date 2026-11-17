// Fontes de dados e o estado de permissão registrado, em texto fixo do front. Não vem do
// backend. Espelha config/sources.yaml e docs/source-methodologies/permissoes.md (seção 5):
// um teste lê o YAML e falha se os ids ou os estados divergirem.
export type PermissionStatus = 'permitida' | 'indefinida' | 'proibida'

export interface SourceInfo {
  id: string
  name: string
  baseUrl: string
  permission: PermissionStatus
  reviewedAt: string // data de calendário, AAAA-MM-DD
  enabled: boolean
  provides: string
  note: string
}

export const SOURCES: readonly SourceInfo[] = [
  {
    id: 'fundamentus',
    name: 'Fundamentus',
    baseUrl: 'https://www.fundamentus.com.br',
    permission: 'indefinida',
    reviewedAt: '2026-11-14',
    enabled: true,
    provides: 'indicadores de ações',
    note: 'A permissão de coleta automatizada não foi comprovada. O site declara que não se responsabiliza por aplicações feitas com os seus dados. O autor habilitou a fonte por conta e risco próprios.',
  },
  {
    id: 'statusinvest',
    name: 'StatusInvest',
    baseUrl: 'https://statusinvest.com.br',
    permission: 'indefinida',
    reviewedAt: '2026-11-14',
    enabled: true,
    provides: 'indicadores de ações',
    note: 'A permissão de coleta automatizada não foi comprovada. O site declara que não se responsabiliza por aplicações feitas com os seus dados. O autor habilitou a fonte por conta e risco próprios.',
  },
  {
    id: 'brapi',
    name: 'brapi',
    baseUrl: 'https://brapi.dev',
    permission: 'permitida',
    reviewedAt: '2026-11-14',
    enabled: true,
    provides: 'cotações',
    note: 'O autor considera o uso coberto pela licença da API nos termos de uso da brapi: acesso com token, dentro do plano gratuito.',
  },
]

export const PERMISSION_LABEL: Record<PermissionStatus, string> = {
  permitida: 'Permitida',
  indefinida: 'Indefinida',
  proibida: 'Proibida',
}
