// Configuração pública do navegador. Só variáveis VITE_ públicas (nada aqui é segredo).
// Sem variáveis (build de CI, testes) aponta para o Supabase local com chave fictícia.
export const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
export const publishableKey: string = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'chave-nao-configurada'

// URL de uma Edge Function: <VITE_SUPABASE_URL>/functions/v1/<nome>.
export function functionUrl(name: 'agent' | 'catalog'): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/${name}`
}
