import { createClient } from '@supabase/supabase-js'

// Só a chave publicável vai para o navegador (E-regras: nada com VITE_ é segredo).
// Sem variáveis (build de CI, testes) o cliente aponta para o Supabase local
// e as chamadas simplesmente falham, o que as telas tratam como erro.
const url = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'chave-nao-configurada'

export const supabase = createClient(url, publishableKey)
