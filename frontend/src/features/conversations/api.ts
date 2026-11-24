import { supabase } from '@/lib/supabase'

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
}

// Mesmo limite do banco: `conversations_title_check` (1 a 200 caracteres).
export const TITLE_MAX = 200
export const DEFAULT_TITLE = 'Nova conversa'

export type TitleCheck = { ok: true; title: string } | { ok: false; message: string }

export function checkTitle(raw: string): TitleCheck {
  const title = raw.trim()
  if (title.length === 0) return { ok: false, message: 'Digite um título. Espaços sozinhos não valem.' }
  // O banco conta caracteres (code points), não unidades UTF-16.
  if ([...title].length > TITLE_MAX) {
    return { ok: false, message: `O título pode ter no máximo ${TITLE_MAX} caracteres.` }
  }
  return { ok: true, title }
}

// A ordem é a do banco: mais recentemente atualizada primeiro (`updated_at` é movido
// pelo gatilho ao renomear e quando chega mensagem nova); `created_at` desempata.
export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// A coluna `user_id` não tem valor padrão e o grant exige `user_id` no insert. Vai o id
// da sessão; a barreira é a política RLS (`user_id = auth.uid()`), que recusa outro valor.
export async function createConversation(userId: string, title: string = DEFAULT_TITLE): Promise<void> {
  const { error } = await supabase.from('conversations').insert({ user_id: userId, title })
  if (error) throw error
}

// Como `createConversation`, mas devolve o id da conversa criada (a carteira navega até ela).
export async function createConversationWithId(userId: string, title: string): Promise<string> {
  const { data, error } = await supabase.from('conversations').insert({ user_id: userId, title }).select('id')
  if (error) throw error
  const id = data?.[0]?.id
  if (typeof id !== 'string') throw new Error('Conversa criada sem identificador.')
  return id
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const { data, error } = await supabase.from('conversations').update({ title }).eq('id', id).select('id')
  if (error) throw error
  // Zero linhas: a conversa não existe mais ou não é do usuário (RLS). Não é sucesso.
  if (!data || data.length === 0) throw new Error('Conversa não encontrada.')
}

export async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from('conversations').delete().eq('id', id)
  if (error) throw error
}
