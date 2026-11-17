import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

beforeEach(() => fake.reset())

test('sem sessão, o botão chama signInWithOAuth com o provedor google', async () => {
  renderApp('/entrar')
  fireEvent.click(await screen.findByRole('button', { name: 'Entrar com Google' }))
  await waitFor(() => expect(fake.client.auth.signInWithOAuth).toHaveBeenCalledTimes(1))
  const args = fake.client.auth.signInWithOAuth.mock.calls[0][0] as {
    provider: string
    options: { redirectTo: string }
  }
  expect(args.provider).toBe('google')
  expect(args.options.redirectTo).toBe(window.location.origin)
})

test('erro ao iniciar o login mostra mensagem e libera o botão', async () => {
  fake.client.auth.signInWithOAuth.mockResolvedValueOnce({ data: {}, error: { message: 'falhou' } })
  renderApp('/entrar')
  fireEvent.click(await screen.findByRole('button', { name: 'Entrar com Google' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível iniciar')
  expect((screen.getByRole('button', { name: 'Entrar com Google' }) as HTMLButtonElement).disabled).toBe(false)
})

test('usuário fora de allowed_users vê acesso não autorizado e pode sair', async () => {
  fake.signIn('u2') // sem linha em allowed_users
  renderApp('/')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Acesso não autorizado')
  expect(screen.queryByRole('heading', { name: 'Conversas' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
  await waitFor(() => expect(fake.client.auth.signOut).toHaveBeenCalledTimes(1))
  expect(await screen.findByRole('button', { name: 'Entrar com Google' })).toBeTruthy()
})

test('usuário desabilitado também é não autorizado', async () => {
  fake.signIn('u3')
  fake.allow('u3', false)
  renderApp('/entrar')
  expect((await screen.findByRole('alert')).textContent).toContain('Acesso não autorizado')
})

test('erro de leitura da autorização é distinto de não autorizado e permite tentar de novo', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  fake.state.errors['allowed_users.select'] = 'rede'
  renderApp('/entrar')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Não foi possível verificar o acesso')
  expect(alert.textContent).not.toContain('Acesso não autorizado')
  fake.state.errors['allowed_users.select'] = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeTruthy()
})

test('erro de leitura da autorização em rota privada não mostra a tela', async () => {
  fake.signIn('u1')
  fake.state.errors['allowed_users.select'] = 'rede'
  renderApp('/')
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível verificar o acesso')
  expect(screen.queryByRole('heading', { name: 'Conversas' })).toBeNull()
})

test('usuário autorizado em /entrar vai para a lista', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  renderApp('/entrar')
  expect(await screen.findByRole('heading', { name: 'Conversas' })).toBeTruthy()
})
