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
