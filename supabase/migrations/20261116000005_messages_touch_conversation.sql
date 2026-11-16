-- T21b: a lista de conversas é ordenada por atualização. A função `agent` grava as
-- mensagens e não toca em `conversations`, então o banco passa a mover
-- `conversations.updated_at` quando uma mensagem é inserida.
-- Aditiva: sem tabela, coluna ou privilégio novo para o cliente. A função roda como o
-- dono (security definer) com search_path vazio e só o gatilho a executa.
create function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- O gatilho `conversations_touch` (before update) grava updated_at = now().
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id
     and user_id = new.user_id;
  return new;
end;
$$;

revoke all on function public.touch_conversation_on_message() from public, anon, authenticated;

create trigger messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation_on_message();
