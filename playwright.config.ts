// Testes ponta a ponta (T21f). Ver docs/tarefas/T21f.md.
//
// Bancada: Supabase local (com o seed.sql), gateway local em Deno servindo os handlers reais
// das funções com MOCK_LLM=true (tests/e2e/support/functions-gateway.ts) e o front em modo de
// desenvolvimento apontando para o gateway. Nada aqui chama LLM, brapi ou fontes reais.
import { defineConfig, devices } from '@playwright/test'
import { FRONT_PORT, FRONT_URL, GATEWAY_PORT, GATEWAY_URL, readLocalSupabase } from './tests/e2e/support/local-supabase'

const local = readLocalSupabase()
const deno = process.env.DENO_BIN || 'deno'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Um worker: os roteiros compartilham o gateway e o seu modo de LLM.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: FRONT_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    // O Chromium pré-instalado pode estar fora do caminho padrão; no CI vale o instalado por
    // `npx playwright install chromium`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'gateway',
      command: `${deno} run --config supabase/functions/deno.json --allow-net=127.0.0.1,localhost --allow-env --allow-read tests/e2e/support/functions-gateway.ts`,
      url: `${GATEWAY_URL}/__e2e/llm-mode`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        GATEWAY_PORT: String(GATEWAY_PORT),
        SUPABASE_URL: local.apiUrl,
        SUPABASE_ANON_KEY: local.anonKey,
        SUPABASE_SERVICE_ROLE_KEY: local.adminKey,
        APP_ORIGINS: `${FRONT_URL},http://localhost:${FRONT_PORT}`,
        APP_ENV: 'local',
        MOCK_LLM: 'true',
      },
    },
    {
      name: 'frontend',
      command: `npm run dev -- --host 127.0.0.1 --port ${FRONT_PORT} --strictPort`,
      cwd: 'frontend',
      url: FRONT_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        // Só valores públicos chegam ao navegador: o endereço do gateway e a chave anônima.
        VITE_SUPABASE_URL: GATEWAY_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: local.anonKey,
        VITE_APP_URL: FRONT_URL,
      },
    },
  ],
})
