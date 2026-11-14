#!/usr/bin/env bash
# Verificações de regras do projeto que não dependem de linguagem.
# Regras: docs/plano-execucao-fatia-acoes.md (seção 3) e docs/adr/0001-primeira-fatia-acoes.md.
# Uso: bash scripts/ci/check_guardrails.sh   (na raiz do repositório)
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"

failures=0
fail() {
  echo "::error::$1"
  failures=$((failures + 1))
}
section() { echo; echo "== $1"; }

# Lista de arquivos versionados, sem este script (ele contém os próprios padrões).
tracked() { git ls-files -- "$@" | grep -v '^scripts/ci/' || true; }

# grep em arquivos versionados; imprime as ocorrências e devolve 0 se achou algo.
grep_tracked() {
  local pattern="$1"; shift
  local files
  files=$(tracked "$@")
  [ -z "$files" ] && return 1
  echo "$files" | tr '\n' '\0' | xargs -0 grep -nIE -- "$pattern" 2>/dev/null
}

section "1. Arquivos .env reais não podem ser versionados"
env_files=$(git ls-files | grep -E '(^|/)\.env' | grep -vE '\.example$' || true)
if [ -n "$env_files" ]; then
  echo "$env_files"
  fail "Arquivo .env versionado. Só arquivos .example podem entrar no repositório."
fi

section "2. Padrões de chave privada"
if grep_tracked 'gsk_[A-Za-z0-9]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.'; then
  fail "Texto com formato de chave privada ou token. Remova e troque a credencial."
fi

section "3. Variáveis VITE_ não podem carregar segredo"
vite_hits=$(grep_tracked 'VITE_[A-Z0-9_]*(SECRET|SERVICE_ROLE|TOKEN|API_KEY)' \
  ':!*.md' ':!.claude/**' || true)
if [ -n "$vite_hits" ]; then
  echo "$vite_hits"
  fail "Variável VITE_ com nome de segredo. Tudo com prefixo VITE_ vai para o navegador."
fi

section "4. Chave administrativa fora do frontend e dos workflows"
if grep_tracked 'service_role|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE' \
  'frontend/**' '.github/workflows/**'; then
  fail "Referência à chave administrativa do Supabase em frontend/ ou em workflow (ADR D13)."
fi

section "5. Fixtures devem ser sintéticas e pequenas"
max_bytes=102400
while IFS= read -r f; do
  [ -z "$f" ] && continue
  size=$(wc -c < "$f")
  if [ "$size" -gt "$max_bytes" ]; then
    fail "Fixture grande demais ($size bytes): $f. Fixtures são escritas à mão, não cópias de páginas reais."
  fi
done < <(git ls-files -- 'collector/tests/fixtures/**')

section "6. Workflows: sem commit vazio e com Actions fixadas em SHA"
if grep_tracked '\-\-allow-empty' '.github/workflows/**'; then
  fail "Commit vazio em workflow. O README (14.5) proíbe contornar a inatividade do cron."
fi
unpinned=$(grep_tracked '^[[:space:]]*-?[[:space:]]*uses:[[:space:]]' '.github/workflows/**' \
  | grep -vE 'uses:[[:space:]]+\./' \
  | grep -vE 'uses:[[:space:]]+[^@[:space:]]+@[0-9a-f]{40}([[:space:]]|$)' || true)
if [ -n "$unpinned" ]; then
  echo "$unpinned"
  fail "Action sem SHA completo. Use 'uses: dono/acao@<sha de 40 caracteres> # vX.Y.Z'."
fi

section "7. Arquivos fora da primeira fatia"
# Remova um item desta lista quando a fatia correspondente for iniciada.
out_of_scope=(
  'collector/src/collector/sources/treasury_official.py'
  'supabase/functions/_shared/llm/gemini.ts'
  'supabase/functions/_shared/pdf'
  'supabase/functions/reports'
)
for p in "${out_of_scope[@]}"; do
  if [ -n "$(git ls-files -- "$p")" ]; then
    fail "Arquivo fora da primeira fatia: $p (ADR 0001, D1 e D6)."
  fi
done

section "8. Sem float em valores do coletor"
# Para um uso legítimo, acrescente na mesma linha o comentário: # guardrail: float-ok
float_hits=$(grep_tracked '(^|[^A-Za-z_.])float\(|:[[:space:]]*float([[:space:]]|=|,|\)|$)|->[[:space:]]*float' \
  'collector/src/**/*.py' | grep -v 'guardrail: float-ok' || true)
if [ -n "$float_hits" ]; then
  echo "$float_hits"
  fail "Uso de float no coletor. Valores financeiros usam decimal.Decimal."
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "Guardrails: $failures falha(s)."
  exit 1
fi
echo "Guardrails: tudo certo."
