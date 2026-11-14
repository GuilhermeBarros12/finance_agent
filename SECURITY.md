# Política de segurança

## Como relatar uma vulnerabilidade

Use o recurso **Report a vulnerability** da aba **Security** deste repositório no GitHub. Esse é o único canal de contato. Não abra issue pública com detalhes de uma vulnerabilidade e não inclua segredos reais no relato.

## Escopo

O projeto é uma aplicação pessoal em desenvolvimento. Interessam relatos sobre:

- segredos ou credenciais expostos no repositório ou no histórico;
- falhas de isolamento entre usuários (RLS) ou de autenticação;
- exposição da chave administrativa do Supabase no frontend ou em workflows.

## Proteções ativas

O repositório tem Secret Protection e Push Protection do GitHub ativos. A CI roda `scripts/ci/check_guardrails.sh`, que barra arquivos `.env` reais e padrões de chave privada.

## Resposta

Este é um projeto mantido por uma pessoa. Não há prazo garantido de resposta.
