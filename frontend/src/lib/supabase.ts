import { createClient } from '@supabase/supabase-js'
import { publishableKey, supabaseUrl } from './config'

// Só a chave publicável vai para o navegador (E-regras: nada com VITE_ é segredo).
// Sem variáveis (build de CI, testes) o cliente aponta para o Supabase local
// e as chamadas simplesmente falham, o que as telas tratam como erro.
export const supabase = createClient(supabaseUrl, publishableKey)
