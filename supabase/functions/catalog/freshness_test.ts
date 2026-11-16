import { assertEquals, assertThrows } from "@std/assert";
import { businessDaysBetween, computeFreshness } from "./freshness.ts";

const d = (s: string) => new Date(s);

// Valores conferidos contra collector.validation.engine.compute_freshness (Python).
Deno.test("frescor: mesmo dia e até 1 dia útil é fresh", () => {
  // 2026-09-18 é sexta; 17:05 em Brasília.
  const c = d("2026-09-18T20:05:00Z");
  assertEquals(computeFreshness(c, d("2026-09-18T21:00:00Z")), "fresh");
  // sábado e domingo: nenhum dia útil novo.
  assertEquals(computeFreshness(c, d("2026-09-19T15:00:00Z")), "fresh");
  assertEquals(computeFreshness(c, d("2026-09-20T15:00:00Z")), "fresh");
  // segunda: 1 dia útil, ainda fresh (limite).
  assertEquals(computeFreshness(c, d("2026-09-21T15:00:00Z")), "fresh");
});

Deno.test("frescor: fronteira stale (>1) e expired (>5) em dias úteis", () => {
  const c = d("2026-09-18T20:05:00Z"); // sexta
  assertEquals(computeFreshness(c, d("2026-09-22T15:00:00Z")), "stale"); // 2 úteis
  assertEquals(computeFreshness(c, d("2026-09-25T15:00:00Z")), "stale"); // 5 úteis
  assertEquals(computeFreshness(c, d("2026-09-28T15:00:00Z")), "expired"); // 6 úteis
  assertEquals(businessDaysBetween(c, d("2026-09-25T15:00:00Z")), 5);
  assertEquals(businessDaysBetween(c, d("2026-09-28T15:00:00Z")), 6);
});

Deno.test("frescor: virada do dia usa Brasília (UTC-3 fixo)", () => {
  // 2026-09-18T02:30Z = 17/09 23:30 em Brasília (quinta).
  const c = d("2026-09-18T02:30:00Z");
  // 18/09 02:59Z ainda é 17/09 23:59 BRT: 0 dias úteis.
  assertEquals(businessDaysBetween(c, d("2026-09-18T02:59:00Z")), 0);
  // 18/09 03:00Z é 18/09 00:00 BRT: 1 dia útil.
  assertEquals(businessDaysBetween(c, d("2026-09-18T03:00:00Z")), 1);
  // 21/09 03:00Z = 21/09 00:00 BRT (segunda): de quinta a segunda são 2 dias úteis.
  assertEquals(computeFreshness(c, d("2026-09-21T03:00:00Z")), "stale");
  assertEquals(computeFreshness(c, d("2026-09-20T14:00:00Z")), "fresh");
});

Deno.test("frescor: coleta no futuro (>5 min) é unknown_reference_date", () => {
  const now = d("2026-09-18T21:00:00Z");
  assertEquals(
    computeFreshness(d("2026-09-18T21:04:59Z"), now),
    "fresh",
  );
  assertEquals(
    computeFreshness(d("2026-09-18T21:05:00Z"), now),
    "fresh",
  );
  assertEquals(
    computeFreshness(d("2026-09-18T21:05:01Z"), now),
    "unknown_reference_date",
  );
});

Deno.test("frescor: data inválida é erro, não um estado", () => {
  assertThrows(() =>
    computeFreshness(new Date("lixo"), d("2026-09-18T21:00:00Z"))
  );
});
