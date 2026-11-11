// PROTÓTIPO DESCARTÁVEL — não entra no produto.
// Gera um PDF 100% sintético com pdf-lib + fontkit para medir CPU/memória/tempo.
import { PDFDocument, PDFFont, PDFPage, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

export interface Params {
  assets: number; // 1 | 5 | 10
  pages: number; // 3 | 8 | 15
  subset: boolean; // subsetting da fonte no embed
}

export interface Metrics {
  assets: number;
  pages: number;
  actualPages: number;
  subset: boolean;
  pdfBytes: number;
  // wall-clock das fases (ms); o trabalho é síncrono/CPU-bound, logo ≈ CPU
  tFontRead: number;
  tEmbed: number;
  tDraw: number;
  tSave: number;
  tTotal: number;
  // CPU do processo, se o runtime expuser Deno.cpuUsage (ms); null se não
  cpuMs: number | null;
  // memória nas fronteiras de fase (MB); pico = máximo das amostras
  rssPeakMb: number;
  heapPeakMb: number;
}

const W = 595.28, H = 841.89, M = 50; // A4
const LINE = 14;
const mb = (n: number) => +(n / 1048576).toFixed(1);

const LOREM = [
  "A análise sintética considera a evolução trimestral do indicador, a variação percentual acumulada no ano e a comparação com a mediana setorial, sem qualquer vínculo com dados reais de mercado.",
  "Ressalvas metodológicas: números ilustrativos, ação preventiva, concentração de operações, informações não auditadas, conciliação de saldos e projeções hipotéticas para fins de teste de consumo.",
  "Este parágrafo existe apenas para exercitar acentuação (ç, ã, õ, é, ê, í, ó, ú, à), quebra de linha manual e texto selecionável no PDF gerado pela função de benchmark.",
];

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// PRNG determinístico: mesmos dados em todas as repetições.
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}

export async function generatePdf(
  p: Params,
  regularBytes: Uint8Array,
  boldBytes: Uint8Array,
  tFontRead: number,
): Promise<{ bytes: Uint8Array; m: Metrics }> {
  const t0 = performance.now();
  const cpu0 = (Deno as any).cpuUsage?.();
  let rssPeak = 0, heapPeak = 0;
  const sample = () => {
    const u = Deno.memoryUsage();
    rssPeak = Math.max(rssPeak, u.rss);
    heapPeak = Math.max(heapPeak, u.heapUsed);
  };
  sample();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const tE0 = performance.now();
  const font = await doc.embedFont(regularBytes, { subset: p.subset });
  const bold = await doc.embedFont(boldBytes, { subset: p.subset });
  const tEmbed = performance.now() - tE0;
  sample();

  const tD0 = performance.now();
  const rnd = rng(42);
  const pages: PDFPage[] = [];
  let page!: PDFPage, y = 0;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M - 20;
  };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };
  const text = (s: string, x: number, size = 10, f = font, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(s, { x, y, size, font: f, color });

  newPage();
  text("Relatório sintético de benchmark", M, 18, bold);
  y -= 24;
  text(`Ativos: ${p.assets} · Páginas-alvo: ${p.pages} · Subsetting: ${p.subset ? "sim" : "não"}`, M, 10);
  y -= 24;

  // Calibra a densidade para fechar em `pages` páginas: mede o bloco fixo de
  // cada ativo (título + parágrafos) e preenche o resto com linhas de tabela.
  const usable = H - 2 * M - 40;
  const rowH = 15;
  const budget = (usable * p.pages - 60) / p.assets; // pt por ativo
  const nParas = budget > 330 ? 3 : budget > 200 ? 1 : 0;
  const paras = LOREM.slice(0, nParas).map((t) => wrap(t, font, 10, W - 2 * M));
  const fixedH = LINE + 4 + paras.reduce((h, l) => h + l.length * LINE + 4, 0) + rowH * 2 + 12;
  const rowsPerAsset = Math.max(1, Math.floor((budget - fixedH) / rowH) - 1);
  const cols = ["Período", "Receita", "Lucro", "Margem", "Var. a/a", "Obs."];
  const colW = (W - 2 * M) / cols.length;

  for (let a = 1; a <= p.assets; a++) {
    need(110);
    text(`${a}. Ativo SINT${String(a).padStart(2, "0")} — Companhia Fictícia ${a} S.A.`, M, 13, bold);
    y -= LINE + 4;
    for (const lines of paras) {
      for (const ln of lines) {
        need(LINE);
        text(ln, M, 10);
        y -= LINE;
      }
      y -= 4;
    }
    need(rowH * 3);
    cols.forEach((c, i) => text(c, M + i * colW, 9, bold));
    page.drawLine({ start: { x: M, y: y - 3 }, end: { x: W - M, y: y - 3 }, thickness: 0.5 });
    y -= rowH;
    for (let r = 0; r < rowsPerAsset; r++) {
      need(rowH);
      const rev = 1000 + rnd() * 9000, lucro = rev * (0.05 + rnd() * 0.2);
      const cells = [
        `${1 + (r % 4)}T${20 + Math.floor(r / 4)}`,
        rev.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
        lucro.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
        `${((lucro / rev) * 100).toFixed(1).replace(".", ",")}%`,
        `${((rnd() - 0.4) * 30).toFixed(1).replace(".", ",")}%`,
        r % 3 === 0 ? "ação/avaliação" : "—",
      ];
      cells.forEach((c, i) => text(c, M + i * colW, 9));
      y -= rowH;
    }
    y -= 12;
    sample();
  }
  // Rodapé com paginação "Página X de Y" (precisa do total → 2ª passada).
  pages.forEach((pg, i) =>
    pg.drawText(`Página ${i + 1} de ${pages.length} · dados sintéticos`, {
      x: M, y: 30, size: 8, font, color: rgb(0.4, 0.4, 0.4),
    })
  );
  const tDraw = performance.now() - tD0;
  sample();

  const tS0 = performance.now();
  const bytes = await doc.save();
  const tSave = performance.now() - tS0;
  sample();

  const cpu1 = (Deno as any).cpuUsage?.();
  return {
    bytes,
    m: {
      assets: p.assets, pages: p.pages, actualPages: pages.length, subset: p.subset,
      pdfBytes: bytes.length,
      tFontRead: +tFontRead.toFixed(1), tEmbed: +tEmbed.toFixed(1),
      tDraw: +tDraw.toFixed(1), tSave: +tSave.toFixed(1),
      tTotal: +(performance.now() - t0).toFixed(1),
      cpuMs: cpu0 && cpu1 ? +((cpu1.user + cpu1.system - cpu0.user - cpu0.system) / 1000).toFixed(1) : null,
      rssPeakMb: mb(rssPeak), heapPeakMb: mb(heapPeak),
    },
  };
}
