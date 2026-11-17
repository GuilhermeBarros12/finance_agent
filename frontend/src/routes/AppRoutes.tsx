import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/features/auth/components/RequireAuth'
import { LoginPage } from '@/features/auth/components/LoginPage'
import { RequireAllowed } from '@/features/auth/components/RequireAllowed'
import { ChatPage } from '@/features/chat/components/ChatPage'
import { ConversationsPage } from '@/features/conversations/components/ConversationsPage'
import { DataStatusPage } from '@/features/data-status/components/DataStatusPage'
import { LegalPage } from '@/features/legal/components/LegalPage'
import { Placeholder } from './Placeholder'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/aviso-legal" element={<LegalPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireAllowed />}>
          <Route element={<AppLayout />}>
            <Route index element={<ConversationsPage />} />
            <Route path="conversas/:id" element={<ChatPage />} />
            <Route path="carteira" element={<Placeholder titulo="Carteira" descricao="A carteira chega na tarefa T21d." />} />
            <Route path="dados" element={<DataStatusPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
