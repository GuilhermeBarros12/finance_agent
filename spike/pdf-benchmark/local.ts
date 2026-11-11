// Smoke/baseline LOCAL (não representa o ambiente hospedado).
// deno run -A local.ts [reps]
import { generatePdf } from "./supabase/functions/pdf-bench/generate.ts";
const dir = new URL("./supabase/functions/pdf-bench/fonts/", import.meta.url);
const reg = await Deno.readFile(new URL("NotoSans-Regular.ttf", dir));
const bold = await Deno.readFile(new URL("NotoSans-Bold.ttf", dir));
const reps = Number(Deno.args[0] ?? 3);
await Deno.mkdir("out", { recursive: true });
console.log("assets pages subset | pgs  KB   total embed draw save cpu  rssPk heapPk");
for (const subset of [true, false])
  for (const assets of [1, 5, 10])
    for (const pages of [3, 8, 15])
      for (let i = 0; i < reps; i++) {
        const { bytes, m } = await generatePdf({ assets, pages, subset }, reg, bold, 0);
        if (i === 0) await Deno.writeFile(`out/a${assets}-p${pages}-${subset ? "sub" : "full"}.pdf`, bytes);
        console.log(`${assets}\t${pages}\t${subset ? 1 : 0}\t| ${m.actualPages}\t${(m.pdfBytes / 1024) | 0}\t${m.tTotal}\t${m.tEmbed}\t${m.tDraw}\t${m.tSave}\t${m.cpuMs}\t${m.rssPeakMb}\t${m.heapPeakMb}`);
      }
