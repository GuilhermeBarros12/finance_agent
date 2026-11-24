import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { catalogBody } from '@/features/chat/fixtures'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

beforeEach(() => {
  fake.reset()
  // /dados, a conversa e a carteira leem o catálogo por fetch: nunca rede de verdade nos testes.
  // O catálogo é válido para a tela de destino não mostrar o próprio alerta de erro antes do
  // alerta de acesso que estes testes procuram.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalogBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })))
})

const PRIVATE = [
  { path: '/', heading: 'Conversas', go: 'Carteira' },
  { path: '/conversas/c-1', heading: 'Conversa', go: 'Conversas' },
  { path: '/carteira', heading: 'Carteira', go: 'Conversas' },
  { path: '/dados', heading: 'Dados', go: 'Conversas' },
]

const authReads = () => fake.state.log.filter((l) => l.table === 'allowed_users' && l.op === 'select').length
const goTo = (name: string) => fireEvent.click(screen.getAllByRole('link', { name })[0])

test.each(PRIVATE)('usuário negado em $path vai para /entrar com alerta', async ({ path, heading }) => {
  fake.signIn('u2') // sem linha em allowed_users
  renderApp(path)
  expect((await screen.findByRole('alert')).textContent).toContain('Acesso não autorizado')
  expect(screen.queryByRole('heading', { name: heading, level: 1 })).toBeNull()
})

test.each(PRIVATE)('usuário revogado em $path cai em /entrar ao navegar', async ({ path, heading, go }) => {
  fake.signIn('u1')
  fake.allow('u1')
  // A rota da conversa agora é o chat real (T21c): precisa de uma conversa do usuário, com o título esperado.
  if (path.startsWith('/conversas/')) {
    fake.state.tables.conversations.push({ id: 'c-1', user_id: 'u1', title: heading, created_at: '2026-11-16T12:00:00Z', updated_at: '2026-11-16T12:00:00Z' })
  }
  renderApp(path)
  await screen.findByRole('heading', { name: heading, level: 1 })
  fake.revoke('u1')
  goTo(go)
  expect((await screen.findByRole('alert')).textContent).toContain('Acesso não autorizado')
  expect(screen.queryByRole('heading', { name: go, level: 1 })).toBeNull()
})

test('usuário desabilitado depois de entrar também cai em /entrar ao navegar', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  renderApp('/carteira')
  await screen.findByRole('heading', { name: 'Carteira', level: 1 })
  fake.setEnabled('u1', false)
  goTo('Dados')
  expect((await screen.findByRole('alert')).textContent).toContain('Acesso não autorizado')
})

test('a autorização é lida de novo a cada mudança de rota, sem tela de carregamento', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  fake.addConversation('Antiga') // lista não vazia: não dispara a releitura extra
  renderApp('/')
  await screen.findByRole('heading', { name: 'Conversas', level: 1 })
  expect(authReads()).toBe(1)
  goTo('Carteira')
  expect(screen.queryByText('Verificando acesso...')).toBeNull()
  await screen.findByRole('heading', { name: 'Carteira', level: 1 })
  await waitFor(() => expect(authReads()).toBe(2))
  goTo('Conversas')
  await screen.findByRole('heading', { name: 'Conversas', level: 1 })
  await waitFor(() => expect(authReads()).toBe(3))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('leitura da autorização que falha na segunda vez mostra erro, não conteúdo nem negado', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  renderApp('/')
  await screen.findByRole('heading', { name: 'Conversas', level: 1 })
  fake.state.errors['allowed_users.select'] = 'rede'
  goTo('Carteira')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Não foi possível verificar o acesso')
  expect(alert.textContent).not.toContain('Acesso não autorizado')
  expect(screen.queryByRole('heading', { name: 'Carteira', level: 1 })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Conversas', level: 1 })).toBeNull()
  fake.state.errors['allowed_users.select'] = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByRole('heading', { name: 'Carteira', level: 1 })).toBeTruthy()
})
