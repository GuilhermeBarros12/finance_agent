#!/usr/bin/env bash
# Confere que o bundle do frontend não contém texto de chave privada.
# Uso: bash scripts/ci/check_bundle.sh <pasta do build, por exemplo frontend/dist>
set -uo pipefail

dist="${1:?informe a pasta do build}"
if [ ! -d "$dist" ]; then
  echo "::error::Pasta de build não encontrada: $dist"
  exit 1
fi

if grep -rIlE 'gsk_[A-Za-z0-9]{20,}|service_role|sb_secret_' "$dist"; then
  echo "::error::O bundle do frontend contém texto de chave privada (arquivos listados acima)."
  exit 1
fi
echo "Bundle sem chave privada."
