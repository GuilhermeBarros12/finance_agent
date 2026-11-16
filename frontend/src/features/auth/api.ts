import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export async function fetchSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export function subscribeToSession(onChange: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => onChange(session))
  return () => data.subscription.unsubscribe()
}

// Só variáveis VITE_ públicas. Sem VITE_APP_URL, volta para a origem atual.
export function appUrl(): string {
  return import.meta.env.VITE_APP_URL || window.location.origin
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: appUrl() },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export type Authorization = 'allowed' | 'denied'

// A autorização vem do banco, com o JWT do usuário: a política de `allowed_users`
// só devolve a própria linha. Falha de leitura lança erro; não vira "negado".
export async function fetchAuthorization(userId: string): Promise<Authorization> {
  const { data, error } = await supabase
    .from('allowed_users')
    .select('user_id, enabled')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data && data.enabled === true ? 'allowed' : 'denied'
}
