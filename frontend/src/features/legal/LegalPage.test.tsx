import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'
import { catalogBody } from '@/features/chat/fixtures'
import { ExternalLink } from './components/ExternalLink'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

beforeEach(() => {
  fake.reset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(catalogBody()), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  )
})

function signedIn() {
  fake.signIn('u1')
  fake.allow('u1')
}

test.each([
  { path: '/', heading: 'Conversas', setup: signedIn },
  { path: '/dados', heading: 'Dados', setup: signedIn },
  { path: '/carteira', heading: 'Carteira', setup: signedIn },
  { path: '/entrar', heading: 'Entrar', setup: () => undefined },
  { path: '/conversas/c-chat', heading: 'Chat', setup: () => {
    signedIn()
    fake.state.tables.conversations.push({ id: 'c-chat', user_id: 'u1', title: 'Chat', created_at: '2026-11-16T12:00:00Z', updated_at: '2026-11-16T12:00:00Z' })
  } },
])('o rodapé de $path leva ao aviso legal', async ({ path, heading, setup }) => {
  setup()
  renderApp(path)
  // O rodapé também existe nas telas de carregamento: espera a tela de verdade.
  await screen.findByRole('heading', { name: heading, level: 1 })
  const footer = await screen.findByRole('contentinfo')
  expect(footer.textContent).toContain('não são recomendação de investimento')
  fireEvent.click(within(footer).getByRole('link', { name: 'Aviso legal' }))
  expect(await screen.findByRole('heading', { name: 'Aviso legal', level: 1 })).toBeTruthy()
})

test('o aviso legal é público: abre sem sessão, sem ir para /entrar', async () => {
  renderApp('/aviso-legal')
  expect(await screen.findByRole('heading', { name: 'Aviso legal', level: 1 })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Entrar' })).toBeNull()
  expect(screen.getByRole('contentinfo')).toBeTruthy()
})

test('traz o texto da seção 23 do README e o aviso de que não é recomendação', async () => {
  renderApp('/aviso-legal')
  await screen.findByRole('heading', { name: 'Aviso legal', level: 1 })
  const text = document.body.textContent ?? ''
  expect(screen.getByRole('note').textContent).toContain('não são recomendação de investimento')
  for (const trecho of [
    'finalidade educacional, experimental e informativa',
    'não constitui recomendação de investimento, análise profissional individualizada, consultoria financeira, oferta ou solicitação de compra ou venda de ativos',
    'erros, atrasos, lacunas ou divergências entre fontes',
    'Respostas geradas por inteligência artificial também podem ser incorretas',
    'não garante a veracidade, a completude ou a adequação de um investimento',
    'Consulte as fontes originais',
    'Decisões de investimento são de responsabilidade do usuário',
    'B3, do Tesouro Nacional, da UFG',
    'não substitui a avaliação das obrigações aplicáveis',
  ]) {
    expect(text).toContain(trecho)
  }
})

test('as fontes têm link https, em nova aba, com rel noopener noreferrer', async () => {
  renderApp('/aviso-legal')
  await screen.findByRole('heading', { name: 'Aviso legal', level: 1 })
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'))
  const hosts = links.map((a) => new URL(a.href).hostname)
  for (const host of ['www.fundamentus.com.br', 'statusinvest.com.br', 'brapi.dev']) expect(hosts).toContain(host)
  for (const a of links) {
    expect(a.href.startsWith('https://')).toBe(true)
    expect(a.rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(a.textContent).toContain('(abre em nova aba)')
  }
})

test('endereço fora das fontes conhecidas não vira link', () => {
  const { container } = render(
    <>
      <ExternalLink href="http://brapi.dev">http</ExternalLink>
      <ExternalLink href="https://exemplo.invalid/x">outro</ExternalLink>
      <ExternalLink href="javascript:alert(1)">js</ExternalLink>
    </>,
  )
  expect(container.querySelector('a')).toBeNull()
  expect(container.textContent).toContain('(link indisponível)')
})

test('o rodapé existe na verificação de sessão (RequireAuth carregando)', async () => {
  fake.client.auth.getSession.mockImplementationOnce(() => new Promise(() => undefined))
  renderApp('/dados')
  expect(await screen.findByText('Verificando sessão...')).toBeTruthy()
  expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Aviso legal' })).toBeTruthy()
})

test('o rodapé existe na verificação de acesso (RequireAllowed carregando)', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  const original = fake.client.from
  vi.spyOn(fake.client, 'from').mockImplementation((table: string) =>
    table === 'allowed_users' ? ({ select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => undefined) }) }) } as never) : original(table),
  )
  renderApp('/dados')
  expect(await screen.findByText('Verificando acesso...')).toBeTruthy()
  expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Aviso legal' })).toBeTruthy()
  vi.restoreAllMocks()
})

test('o rodapé existe no erro de verificação de acesso (RequireAllowed com erro)', async () => {
  fake.signIn('u1')
  fake.allow('u1')
  fake.state.errors['allowed_users.select'] = 'rede'
  renderApp('/dados')
  expect(await screen.findByText('Não foi possível verificar o acesso')).toBeTruthy()
  expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Aviso legal' })).toBeTruthy()
})
