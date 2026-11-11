// PROTÓTIPO DESCARTÁVEL — não entra no produto.
// GET /pdf-bench?assets=5&pages=8&subset=1[&return=pdf]
import { generatePdf } from "./generate.ts";

const ALLOWED_ASSETS = [1, 5, 10];
const ALLOWED_PAGES = [3, 8, 15];
let requestsInIsolate = 0; // 0 => cold start; >0 => isolate reaproveitado

Deno.serve(async (req) => {
  const n = requestsInIsolate++;
  const q = new URL(req.url).searchParams;
  const assets = Number(q.get("assets") ?? 1);
  const pages = Number(q.get("pages") ?? 3);
  const subset = q.get("subset") === "1";
  if (!ALLOWED_ASSETS.includes(assets) || !ALLOWED_PAGES.includes(pages)) {
    return Response.json({ error: "assets∈{1,5,10}, pages∈{3,8,15}" }, { status: 400 });
  }
  try {
    // A fonte é lida a cada requisição (sem cache) para o custo ficar visível.
    const t = performance.now();
    const [reg, bold] = await Promise.all([
      Deno.readFile(new URL("./fonts/NotoSans-Regular.ttf", import.meta.url)),
      Deno.readFile(new URL("./fonts/NotoSans-Bold.ttf", import.meta.url)),
    ]);
    const tFontRead = performance.now() - t;
    const { bytes, m } = await generatePdf({ assets, pages, subset }, reg, bold, tFontRead);
    if (q.get("return") === "pdf") {
      return new Response(bytes, { headers: { "content-type": "application/pdf" } });
    }
    return Response.json({ ...m, isolateRequestIndex: n });
  } catch (e) {
    return Response.json({ error: String(e), isolateRequestIndex: n }, { status: 500 });
  }
});
