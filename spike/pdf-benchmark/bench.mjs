// PROTÓTIPO DESCARTÁVEL. Mede a função HOSPEDADA.
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=... node bench.mjs [reps=5]
// Saída: results.json (bruto) + tabela markdown em stdout.
import { writeFileSync } from "node:fs";
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY;
if (!URL_ || !KEY) { console.error("defina SUPABASE_URL e SUPABASE_ANON_KEY"); process.exit(1); }
const reps = Number(process.argv[2] ?? 5);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const rows = [];
for (const subset of [1, 0]) for (const assets of [1, 5, 10]) for (const pages of [3, 8, 15]) {
  const runs = [];
  for (let i = 0; i < reps; i++) {
    const t = performance.now();
    let status = 0, body = null, err = null;
    try {
      const r = await fetch(`${URL_}/functions/v1/pdf-bench?assets=${assets}&pages=${pages}&subset=${subset}`,
        { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(170_000) });
      status = r.status; const txt = await r.text();
      try { body = JSON.parse(txt); } catch { body = { raw: txt.slice(0, 200) }; }
    } catch (e) { err = String(e); }
    runs.push({ status, err, ms: performance.now() - t, body });
    await new Promise((r) => setTimeout(r, 500));
  }
  rows.push({ assets, pages, subset, runs });
  const ok = runs.filter((r) => r.status === 200);
  console.error(`a=${assets} p=${pages} sub=${subset}: ${ok.length}/${reps} ok`);
}
writeFileSync("results.json", JSON.stringify(rows, null, 1));
console.log("| ativos | págs (real) | subset | ok/N | total cliente ms (med/max) | CPU ms (med/max) | embed ms | rss pico MB (max) | KB | falhas |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const ok = r.runs.filter((x) => x.status === 200), b = ok.map((x) => x.body);
  const f = r.runs.filter((x) => x.status !== 200).map((x) => x.status || "net").join(",") || "—";
  const cpu = b.map((x) => x.cpuMs).filter((x) => x != null);
  console.log(`| ${r.assets} | ${r.pages} (${b[0]?.actualPages ?? "?"}) | ${r.subset ? "sim" : "não"} | ${ok.length}/${r.runs.length} | ` +
    `${ok.length ? `${med(ok.map((x) => x.ms)).toFixed(0)}/${Math.max(...ok.map((x) => x.ms)).toFixed(0)}` : "—"} | ` +
    `${cpu.length ? `${med(cpu).toFixed(0)}/${Math.max(...cpu).toFixed(0)}` : "n/d"} | ` +
    `${b.length ? med(b.map((x) => x.tEmbed)).toFixed(0) : "—"} | ${b.length ? Math.max(...b.map((x) => x.rssPeakMb)) : "—"} | ` +
    `${b.length ? (b[0].pdfBytes / 1024) | 0 : "—"} | ${f} |`);
}
