import { assertEquals } from "@std/assert";
import { buildReferenceUrl } from "./reference.ts";

Deno.test("link de referência: montado de classe, símbolo e base_url do cadastro", () => {
  assertEquals(
    buildReferenceUrl("https://statusinvest.com.br", "stock", "PETR4"),
    "https://statusinvest.com.br/acoes/petr4",
  );
  assertEquals(
    buildReferenceUrl("https://statusinvest.com.br/", "stock", "DEMO3"),
    "https://statusinvest.com.br/acoes/demo3",
  );
});

Deno.test("link de referência: só https, sem credenciais, porta, parâmetros ou fragmento", () => {
  const ruins = [
    "http://statusinvest.com.br",
    "https://u:p@statusinvest.com.br",
    "https://statusinvest.com.br:8443",
    "https://statusinvest.com.br/?token=abc",
    "https://statusinvest.com.br/#x",
    "https://localhost",
    "ftp://statusinvest.com.br",
    "lixo",
    "",
    null,
    undefined,
  ];
  for (const base of ruins) {
    assertEquals(buildReferenceUrl(base, "stock", "PETR4"), null, String(base));
  }
});

Deno.test("link de referência: classe desconhecida ou símbolo fora do padrão => nulo", () => {
  assertEquals(
    buildReferenceUrl("https://statusinvest.com.br", "fii", "HGLG11"),
    null,
  );
  assertEquals(
    buildReferenceUrl("https://statusinvest.com.br", "stock", "pe/tr"),
    null,
  );
  assertEquals(
    buildReferenceUrl("https://statusinvest.com.br", "stock", "petr4"),
    null,
  );
});
