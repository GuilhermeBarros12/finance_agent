import { assert, assertEquals } from "@std/assert";
import { MAX_REASON_LENGTH, sanitizeId, sanitizeReason } from "./sanitize.ts";

Deno.test("sanitizeReason: texto comum passa", () => {
  assertEquals(
    sanitizeReason("Tempo esgotado ao coletar a página"),
    "Tempo esgotado ao coletar a página",
  );
});

Deno.test("sanitizeReason: URL com token, string de conexão e credenciais saem", () => {
  const out = sanitizeReason(
    "falha em https://api.exemplo.test/x?token=abc123&k=1 e postgresql://u:senha@db.test:5432/x " +
      "Authorization: Bearer eyJhbGciOi.eyJzdWIiOiIx.assinatura apikey=segredo123 sb_secret_abcdef",
  );
  for (
    const proibido of [
      "https",
      "token=abc123",
      "postgresql",
      "senha",
      "eyJ",
      "segredo123",
      "sb_secret",
      "abc123",
    ]
  ) {
    assert(!out.includes(proibido), `${proibido} em: ${out}`);
  }
  assert(out.includes("[removido]"));
});

Deno.test("sanitizeReason: HTML sai (tags, aberta, entidades)", () => {
  const out = sanitizeReason(
    "<html><body><script>alert(1)</script>Erro 500</body></html> <b onclick='x'>oi &lt;b&gt; <unclosed",
  );
  assert(!/[<>]/.test(out), out);
  assert(!out.includes("&lt;"));
  assert(out.includes("Erro 500"));
});

Deno.test("sanitizeReason: trunca, normaliza espaços e nunca devolve vazio", () => {
  const long = sanitizeReason("palavra ".repeat(100));
  assert(long.length <= MAX_REASON_LENGTH);
  assert(long.endsWith("…"));
  assertEquals(sanitizeReason("a\n\n\tb\u0000c"), "a b c");
  assertEquals(sanitizeReason("<br>"), "Falha sem detalhe disponível.");
  assertEquals(sanitizeReason(""), "Falha sem detalhe disponível.");
});

Deno.test("sanitizeReason: sequência longa (chave/hash) sai", () => {
  const out = sanitizeReason("chave " + "A1b2".repeat(12));
  assert(!out.includes("A1b2A1b2"));
});

Deno.test("sanitizeId: só caracteres seguros e tamanho limitado", () => {
  assertEquals(sanitizeId(" VALE3 "), "VALE3");
  assertEquals(sanitizeId("a/b?c=d<x>"), "a_b_c_d_x_");
  assertEquals(sanitizeId("x".repeat(100)).length, 40);
});
