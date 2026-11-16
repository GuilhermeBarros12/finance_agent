import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/features/auth/components/RequireAuth'
import { Placeholder } from './Placeholder'

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/entrar"
        element={
          <main className="p-4 md:p-8">
            <Placeholder titulo="Entrar" descricao="O formulário de login chega na tarefa T21b." />
          </main>
        }
      />
      <Route
        path="/aviso-legal"
        element={
          <main className="p-4 md:p-8">
            <Placeholder titulo="Aviso legal" descricao="O texto do aviso chega na tarefa T21f." />
          </main>
        }
      />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Placeholder titulo="Conversas" descricao="A lista de conversas chega na tarefa T21b." />} />
          <Route
            path="conversas/:id"
            element={<Placeholder titulo="Conversa" descricao="O chat chega na tarefa T21c." />}
          />
          <Route path="carteira" element={<Placeholder titulo="Carteira" descricao="A carteira chega na tarefa T21e." />} />
          <Route path="dados" element={<Placeholder titulo="Dados" descricao="O estado dos dados chega na tarefa T21f." />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
