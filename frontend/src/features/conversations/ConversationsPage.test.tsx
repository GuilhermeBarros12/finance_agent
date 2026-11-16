import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { renderApp } from '@/test/renderApp'

vi.mock('@/lib/supabase', async () => ({ supabase: (await import('@/test/fakeSupabase')).fake.client }))

beforeEach(() => {
  fake.reset()
  fake.signIn('u1')
  fake.allow('u1')
})

const titles = () => screen.getAllByRole('listitem').map((li) => within(li).getByRole('link').textContent)
const writes = () => fake.state.log.filter((l) => l.op !== 'select')

test('lista vazia mostra o estado vazio, sem tabela', async () => {
  renderApp('/')
  expect(await screen.findByText('Nenhuma conversa ainda')).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})

test('lista com itens ordenada por atualização, da mais recente para a mais antiga', async () => {
  fake.addConversation('Primeira')
  const segunda = fake.addConversation('Segunda')
  fake.addConversation('Terceira')
  fake.addConversation('De outra pessoa', 'u2')
  fake.touch(segunda.id as string)
  renderApp('/')
  await screen.findByRole('list')
  expect(titles()).toEqual(['Segunda', 'Terceira', 'Primeira'])
})

test('carregando mostra o estado de carregamento com texto', async () => {
  let release: () => void = () => {}
  fake.state.readGate = new Promise<void>((resolve) => (release = resolve))
  renderApp('/')
  expect((await screen.findByText('Carregando conversas...')).closest('[role="status"]')).toBeTruthy()
  fake.state.readGate = null
  release()
  expect(await screen.findByText('Nenhuma conversa ainda')).toBeTruthy()
})

test('erro de carregamento mostra erro, não lista vazia, e tentar de novo relê', async () => {
  fake.addConversation('Primeira')
  fake.state.errors['conversations.select'] = 'rede'
  renderApp('/')
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Não foi possível carregar as conversas')
  expect(screen.queryByText('Nenhuma conversa ainda')).toBeNull()
  fake.state.errors['conversations.select'] = undefined
  fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByRole('link', { name: 'Primeira' })).toBeTruthy()
})

test('criar envia o id da sessão e relê a lista', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  await screen.findByRole('list')
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  expect((await screen.findByText('Conversa criada.')).textContent).toBeTruthy()
  expect(writes()[0]).toMatchObject({ table: 'conversations', op: 'insert', payload: { user_id: 'u1' } })
  expect(titles()).toEqual(['Nova conversa', 'Antiga'])
})

test('renomear altera o título e relê; título vazio ou só espaços é recusado sem escrever', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Renomear Antiga' }))
  const input = screen.getByLabelText('Novo título')
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar título' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Digite um título')
  fireEvent.change(input, { target: { value: 'x'.repeat(201) } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar título' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no máximo 200'))
  expect(writes()).toHaveLength(0)
  fireEvent.change(input, { target: { value: '  Nova ideia  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar título' }))
  expect(await screen.findByText('Título alterado.')).toBeTruthy()
  expect(writes()[0]).toMatchObject({ op: 'update', payload: { title: 'Nova ideia' } })
  expect(titles()).toEqual(['Nova ideia'])
})

test('excluir pede confirmação: cancelar não exclui', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir Antiga' }))
  const dialog = screen.getByRole('alertdialog')
  expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBe(document.activeElement)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(writes()).toHaveLength(0)
  expect(titles()).toEqual(['Antiga'])
})

test('Esc fecha o diálogo sem excluir e devolve o foco', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  const opener = await screen.findByRole('button', { name: 'Excluir Antiga' })
  opener.focus()
  fireEvent.click(opener)
  fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(writes()).toHaveLength(0)
  expect(document.activeElement).toBe(opener)
})

test('confirmar exclui e relê a lista do banco', async () => {
  fake.addConversation('Antiga')
  fake.addConversation('Outra')
  renderApp('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir Antiga' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Excluir conversa/ }))
  expect(await screen.findByText('Conversa excluída.')).toBeTruthy()
  expect(writes()[0]).toMatchObject({ op: 'delete' })
  const selects = fake.state.log.filter((l) => l.op === 'select' && l.table === 'conversations')
  expect(selects.length).toBeGreaterThanOrEqual(2)
  expect(titles()).toEqual(['Outra'])
})

test('sem atualização otimista: a lista só muda depois da releitura', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir Antiga' }))
  let release: () => void = () => {}
  fake.state.gate = new Promise<void>((resolve) => (release = resolve))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Excluir conversa/ }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(titles()).toEqual(['Antiga']) // escrita em andamento: nada mudou na tela
  fake.state.gate = null
  release()
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Antiga' })).toBeNull())
})

test('criar sem otimismo: a nova conversa não aparece antes da escrita terminar', async () => {
  renderApp('/')
  await screen.findByText('Nenhuma conversa ainda')
  let release: () => void = () => {}
  fake.state.gate = new Promise<void>((resolve) => (release = resolve))
  fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(screen.queryByRole('list')).toBeNull()
  fake.state.gate = null
  release()
  expect(await screen.findByRole('link', { name: 'Nova conversa' })).toBeTruthy()
})

test('erro de escrita mostra mensagem e a lista continua como está no banco', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Excluir Antiga' }))
  fake.state.errors['conversations.delete'] = 'sem permissão'
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Excluir conversa/ }))
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível excluir')
  expect(titles()).toEqual(['Antiga'])
  const selects = fake.state.log.filter((l) => l.op === 'select' && l.table === 'conversations')
  expect(selects.length).toBeGreaterThanOrEqual(2) // releu mesmo com a escrita falhando
})

test('erro ao renomear mostra mensagem e mantém o título do banco', async () => {
  fake.addConversation('Antiga')
  renderApp('/')
  fireEvent.click(await screen.findByRole('button', { name: 'Renomear Antiga' }))
  fake.state.errors['conversations.update'] = 'rede'
  fireEvent.change(screen.getByLabelText('Novo título'), { target: { value: 'Outro' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar título' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível renomear')
  expect(titles()).toEqual(['Antiga'])
})
