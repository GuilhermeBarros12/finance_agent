# Spike descartável: benchmark de `pdf-lib` em Edge Function

**Não entra no produto.** Mede se o orçamento de 10 ativos / 15 páginas (README raiz §10.1, §10.3, §17, critério 19.3) cabe nos limites do plano Free (CPU ~2 s, 256 MB, 150 s).
Dados 100% sintéticos. Fonte: Noto Sans (SIL OFL 1.1, licença gravada na tabela `name` do TTF).

## Local (baseline, não vale como medição hospedada)
    deno run -A local.ts 3        # grava PDFs em out/ e imprime tempos/CPU/RSS

## Hospedado (a medição que importa)
Use um projeto **Free de teste** (sem billing, sem dados reais).

    npm i -g supabase    # ou npx supabase
    supabase login
    supabase functions deploy pdf-bench --project-ref <REF> --use-api   # lê static_files do config.toml
    export SUPABASE_URL=https://<REF>.supabase.co SUPABASE_ANON_KEY=<anon>
    node bench.mjs 5

- `cpuMs` vem de `Deno.cpuUsage()`; se o runtime hospedado não expuser, aparece `n/d` e o CPU autoritativo é o gráfico de CPU time da função no Dashboard (Edge Functions → pdf-bench → Metrics) e os logs.
- `isolateRequestIndex = 0` marca cold start; os demais são isolate reaproveitado. `bench.mjs` registra status: 546 = limite de recurso (CPU/memória), 504/timeout = duração.
- Ao terminar: `supabase functions delete pdf-bench --project-ref <REF>`.
