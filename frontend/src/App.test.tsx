import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { SessionProvider } from '@/features/auth/hooks/SessionProvider'
import { AppRoutes } from '@/routes/AppRoutes'

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

function renderAt(path: string) {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </SessionProvider>,
  )
}

beforeEach(() => getSession.mockReset())

test('rota privada sem sessão redireciona para /entrar', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null })
  renderAt('/carteira')
  expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Carteira' })).toBeNull()
})

test('rota privada com sessão mostra a tela e a navegação', async () => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
  renderAt('/carteira')
  expect(await screen.findByRole('heading', { name: 'Carteira' })).toBeTruthy()
  await waitFor(() => expect(screen.getAllByRole('navigation', { name: 'Principal' }).length).toBe(2))
})

test('erro ao verificar a sessão mostra estado de erro, não a tela', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: new Error('falhou') })
  renderAt('/dados')
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Dados' })).toBeNull()
})

test('rotas públicas abrem sem sessão', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null })
  renderAt('/aviso-legal')
  expect(await screen.findByRole('heading', { name: 'Aviso legal' })).toBeTruthy()
})
